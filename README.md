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

Another thing to keep in mind: This is meant for data, and **only** data. You obviously cannot save functions into Redis.
if you try, things will go horribly wrong, so just don't. What you should also keep in mind: It is currently not designed
for nested data. So if you e.g. have an Object of Arrays you're best off having a native Object, and then populate it with SavedArray instances.
Modifing Saved to support this structure natively could be possible. Feel free to PR.

Also: With Arrays, **only the array data is saved**. If you, e.g., do `someArray["foo"] = "bar"`, which is supported by JS
due to how JS works, that value will **not** be (re-)stored.

Conversions that happen in the chain:

- floats which end with `.0` are converted to integer

## TODO
- Add tests
- Find and fix bugs

## License

MIT