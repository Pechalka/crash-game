const Queue = require('bull');
const EventEmitter = require('events');

const createQueue = (name) => {
    const emitter = new EventEmitter();

    return {
        add: (eventName, data) => {
            emitter.emit(eventName, data)
        },
        on: (eventName, cb) => {
            emitter.on(eventName, cb);
        }
    }
}

const createBullQueue = (name) => {
    console.log('process.env.REDIS_URL bull', process.env.REDIS_URL_BULL);
    return new Queue(name, {
        redis:  process.env.REDIS_URL_BULL || 'redis://localhost:6379',
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
            removeOnFail: false,
            
            // removeOnComplete: false,
            // removeOnFail: true, 
        }
    });
}



module.exports = {
    createQueue,
    createBullQueue,
}