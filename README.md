# Saved - Permanent native Arrays and Objects


I wanted to have something that is useable like a native Array / Object
which however is saved permanently, and restored upon restarts while
not being async. Since such a thing didnt exist, Saved was created.

## Install

```
npm i saved --save
```

## Usage

Just replace the initialization of your Objects / Arrays w/ the Saved methods.

### Native

```js
var someArray = [];
var someObject = {};
```

### Saved

```js
const Saved = require('saved');
const Redis = require('redis');

const redis_client = Redis.createClient();

const someArray = Saved.Array(redis_client, 'NameInRedis'[, function ready(err){}]);
const someObject = Saved.Object(redis_client, 'NameInRedis'[, function ready(err){}]);
```

## Keep in mind

After initializing a Saved object, you cannot simply overwrite the variable.
If you need to completely overwrite the *values* it holds, use the `overwrite` function.

### Native
```
someArray = ["foo", "bar"];
```

### Saved
```
someArray.overwrite(["foo", "bar"]);
```

## TODO
- Add tests
- Find and fix bugs

## License

MIT