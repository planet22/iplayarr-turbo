// Preload: swaps ioredis for the in-memory mock so the real server can run without a Redis.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'ioredis') {
        return origLoad.call(this, 'ioredis-mock', parent, isMain);
    }
    return origLoad.call(this, request, parent, isMain);
};
