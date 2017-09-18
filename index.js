function JSToRedis(value) {
	if(value === undefined || value === null)
		return 'null';

	if(typeof value === 'object' || typeof value === 'string')
		return JSON.stringify(value);

	return value;
}

function JSONTryParse(str) {
	try {
		return JSON.parse(str);
	} catch (e) {
		return str;
	}
}

function RedisToJS(value) {
	if(value === 'null')
		return null;

	if(!isNaN(value))
		return Number(value);

	return JSONTryParse(value);
}

function RedisListInsert(redis, keyName, values, func = 'rpush') {
	if(!values || !values.length)
		return;

	let execOn = redis;

	if(values.length > 1)
		execOn = redis.multi();

	for(let i = 0; i < values.length; i++)
		execOn[func](keyName, JSToRedis(values[i]));

	if(values.length > 1)
		execOn.exec();
}

function RedisListDelete(redis, keyName, index, amount) {
	//When _client is set, its an indicator that its a multi obj. Possibly switch out for instanceof.
	let multi = !redis._client ? redis.multi() : redis;
	while(--amount >= 0)
		multi.lset(keyName, index + amount, REDIS_TMP_PIVOT_KEY);

	multi.lrem(keyName, 0, REDIS_TMP_PIVOT_KEY);

	if(!redis._client)
		multi.exec();
}

const REDIS_TMP_PIVOT_KEY = 'DUMMY_PLACEHOLDER#WE+WANT*TO!DELETE:OR;UPDATE&THIS/SO(LETS=DO°IT?';
const OBJECT_PREFIX = 'SAVEDOBJ:';
const ARRAY_PREFIX = 'SAVEDARR:';

function SavedArray(redis, keyName, readyCb) {
	const rawArray = [];

	keyName = ARRAY_PREFIX + keyName;

	const SavedArrayFuncs = {
		push() {
			RedisListInsert(redis, keyName, arguments);
			return rawArray.push(...arguments);
		},
		shift() {
			redis.lpop(keyName);
			return rawArray.shift();
		},
		unshift() {
			RedisListInsert(redis, keyName, arguments, 'lpush');
			return rawArray.unshift(...arguments);
		},
		//"Some" optimization for the Redis side as this often is faster than shifting the values up 1 by 1
		//(like the default implementation would) Removing this custom method would *work*, but it will cause
		//overhead on the Redis side of things. Makes me wonder if this *optimization* ends up causing more overhead, lol.
		splice(index, deleteCount) {
			//No arguments = no action.
			if(arguments.length === 0 || index > rawArray)
				return [];

			let toInsert = Math.max(arguments.length - 2, 0), //First two args arent insert-vals
					toDelete = deleteCount;

			//This exact behaviour is the default per spec
			if(toDelete === undefined)
				toDelete = rawArray.length - index;

			let toOverwrite = Math.min(toInsert, toDelete);

			let multi = redis.multi();

			//Since we don't just insert, but also remove values we might aswell overwrite as much as possible values
			//that would be removed anyways to save some ops
			for(let i = 0; i < toOverwrite; i++) {
				multi.lset(keyName, index + i, JSToRedis(arguments[2 + i]));

				rawArray[index + i] = arguments[2 + i];
			}

			//We try to insert more than we delete, so we need to insert the extra values into Redis
			if(toOverwrite < toInsert) {
				multi.lset(keyName, index + toOverwrite - 1, REDIS_TMP_PIVOT_KEY);

				for(let i = toOverwrite; i < toInsert; i++)
					multi.linsert(keyName, 'AFTER', REDIS_TMP_PIVOT_KEY, JSToRedis(arguments[2 + i]));

				multi.lset(keyName, index + toOverwrite - 1, JSToRedis(rawArray[index + toOverwrite - 1]));
			}

			//If we delete more than we try to insert, we gotta finally remove the more of them from Redis
			if(toDelete > toInsert)
				RedisListDelete(multi, keyName, index, toDelete - toInsert);

			multi.exec();

			//Now after doing all of this stuff for such little gain in the end, we can finally do the native oneliner..
			return rawArray.splice(...arguments);
		},
		overwrite(newValues = []) {
			if(!newValues || newValues.constructor !== Array)
				throw new Error('Replacement must be typeof array!');

			if(!newValues.length)
				redis.del(keyName);
			else {
				let multi = redis.multi();
				multi.del(keyName);
				multi.lpush(keyName, ...newValues.map(JSToRedis));
				multi.exec();
			}

			rawArray.splice(0);
			for(let i = 0; i < newValues.length; i++)
				rawArray.push(RedisToJS(newValues[i]));
		}
	};

	function loadFromRedis() {
		redis.lrange(keyName, 0, -1, (err, arrBackup) => {
			if(!err && arrBackup.length > 0) {
				rawArray.splice(0);
				for(let i = 0; i < arrBackup.length; i++)
					rawArray.push(RedisToJS(arrBackup[i]));
			}

			//For some reason the proxy will return an empty array, even if the rawArray is populated, unless we use this hack.
			readyCb(err);
		});
	}

	if(redis.connected && !redis.command_queue_length && !redis.offline_queue_length) loadFromRedis();
	//Ready really seems like the best option. When init'ing a new instance of SavedArray it is possible to do some
	//Actions before we were able to restore from Redis. 'ready' is called after any queued operation has been processed.
	//Doing normal Sets, shifts and pushes should work fine before its restored, splice however will cause issues.
	//So when we finally processed anything that possibly happened, we restore from the Redis list, which should be the most accurate
	//representation of the current "real" state
	redis.on('ready', loadFromRedis);

	return new Proxy(rawArray, {
		set (target, index, value) {
			//Operations like 'pop' will just decrease the length of the array, so when this happens we need to remove the values from
			//the redis list as well
			if(index === 'length' && value < target.length) {
				RedisListDelete(redis, keyName, value, target.length - value);

				target[index] = value;
				return true;
			}

			let parsedInt = parseInt(index, 10);

			//While you can set non-integer values of an array, they do not count as "real" values
			if(!isNaN(parsedInt) && Number(index) === parsedInt && parsedInt >= 0) {
				if(parsedInt < target.length) {
					redis.lset(keyName, parsedInt, JSToRedis(value));
				} else {
					//You can e.g. set index 100 of an empty array, the values before that get filled with undefined
					//These fillings however do not cause any (proxy) calls, so we must manually replicate it for the Redis side
					let toPush = Array(parsedInt - target.length);
					toPush.push(value);

					RedisListInsert(redis, keyName, toPush);

					target.push(value);

					return true;
				}
			}

			target[index] = value;
			return true;
		},
		deleteProperty (target, index) {
			let parsedInt = parseInt(index, 10);

			//calling delete on an array will remove the value, but it wont shift down the array, so lets do the same for Redis.
			if(!isNaN(parsedInt) && Number(index) === parsedInt && parsedInt >= 0)
				redis.lset(keyName, parsedInt, 'null');

			delete target[index];
			return true;
		},
		has (target, property) {
			return property in SavedArrayFuncs || property in target;
		},
		get (target, property) {
			if (property in SavedArrayFuncs) {
				return SavedArrayFuncs[property].bind(target);
			} else {
				return target[property];
			}
		}
	});
}

//Why cant the Array be as ez as this. I really didnt want to represent the array as a hash in Redis though.
function SavedObject(redis, keyName, readyCb) {
	const rawObject = {};

	keyName = OBJECT_PREFIX + keyName;

	const SavedObjectFuncs = {
		overwrite(newObject = {}) {
			let multi = redis.multi();
			multi.del(keyName);
			for(let key in newObject)
				multi.hset(keyName, key, JSToRedis(newObject[key]));
			multi.exec();

			for(let k in rawObject)
				delete rawObject[k];

			for(let k in newObject)
				rawObject[k] = newObject[k];
		}
	};

	function loadFromRedis() {
		//Get up to 4294967295 rows from array (Max keys in JS obj). Splitting it into batches *might* be better, but for now I don't care.
		redis.hscan(keyName, 0, 'COUNT', 4294967295, (err, objBackup) => {
			if(!err && objBackup) {
				for(let k in rawObject)
					delete rawObject[k];

				for(let i = 0; i < objBackup[1].length; i += 2)
					rawObject[objBackup[1][i]] = RedisToJS(objBackup[1][i+1]);
			}

			readyCb(err);
		});
	}

	if(redis.connected && !redis.command_queue_length) loadFromRedis();
	redis.on('ready', loadFromRedis);

	return new Proxy(rawObject, {
		set (target, key, value) {
			redis.hset(keyName, key, JSToRedis(value));

			target[key] = value;
			return true;
		},
		deleteProperty (target, key) {
			redis.hdel(keyName, key);

			delete target[key];
			return true;
		},
		has (target, property) {
			return property in SavedObjectFuncs || property in target;
		},
		get (target, property) {
			if (property in SavedObjectFuncs) {
				return SavedObjectFuncs[property].bind(target);
			} else {
				return target[property];
			}
		}
	});
}

module.exports.Array = SavedArray;
module.exports.Object = SavedObject;