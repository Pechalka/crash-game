const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { Emitter } = require('@socket.io/redis-emitter');
const redis = require('redis');

const createServer = (httpServer) => {
	return new Server(httpServer, {
		cors: {
			origin: '*',
			methods: ['GET', 'POST'],
		},
	});
}

const initRediceAdapter = async (io) => {
	try {
		console.log('process.env.REDIS_URL sockets server', process.env.REDIS_URL_SOKETS);

		// ✅ ОТДЕЛЬНЫЕ клиенты для адаптера
		const pubClient = redis.createClient({
			url: process.env.REDIS_URL_SOKETS || 'redis://localhost:6379'
		});
		const subClient = pubClient.duplicate();

		await pubClient.connect();
		await subClient.connect();

		io.adapter(createAdapter(pubClient, subClient));
		console.log('✅ Redis adapter initialized');

		return io;
	} catch (error) {
		console.error('❌ Redis adapter failed:', error);
		throw error;
	}
};


const getEmitter = async () => {
	try {

		console.log('process.env.REDIS_URL sockets', process.env.REDIS_URL_SOKETS);
		// ✅ ОТДЕЛЬНЫЙ клиент для emitter
		const pubClient = redis.createClient({
			url: process.env.REDIS_URL_SOKETS || 'redis://localhost:6379'
		});

		await pubClient.connect();
		console.log('✅ Redis emitter client connected');

		const emitter = new Emitter(pubClient);
		console.log('✅ Redis emitter initialized');

		return emitter;
	} catch (error) {
		console.error('❌ Redis emitter failed:', error);
		throw error;
	}
};

module.exports = { createServer, initRediceAdapter, getEmitter };