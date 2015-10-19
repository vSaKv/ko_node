/**
 * Author: Sergei Krutov
 * Date: 10/15/15
 * For: kochava test project.
 * Version: 1
 */

'use strict';

var redis = require('redis');
var http = require('http');
var crypto = require('crypto');
var url = require("url");
var cluster = require('cluster');

function Consumer() {

	var self = this;

	this.config = {
		responseTimeOut :  	10, 							//how long to wait for response
		crashTimeOut :  	30, 							//how long to wait before consider client is crashed and retry to send request
		activeConnections:	80, 							//concurrent connections
		deliveryAttempts : 	[30,50], 						//time betweem delivery attempts [10,20....,n], where number in seconds between and array length amount of attempts

		unknownKeyValue:	"test",							//value to replace unmatched key in placeholder
		enableCluster:		false,							//run client in cluster mode to utilize available CPU cores
		numCPUs : 			require('os').cpus().length 	//how many CPU
	}

	this.startTime=Math.floor(Date.now() / 1000);			//time when client starts
	this.startFirstMinute=Math.floor(Date.now() / 1000);	//time anchor to calculate performance
	this.startEndMinute=Math.floor(Date.now() / 1000);		//time anchor to calculate performance


	this.shutingDown=false;									//soft termination request, will wait for response timeout +5 seconds, to allow all connection to close


	//benchmark counters
	this.successCounter=0;
	this.failedCounter =0;
	this.totalCallsPerSession=0;
	this.sessionGetReq=0;
	this.sessionPostReq=0;
	this.succesGetReq=0;
	this.failedGetReq=0;
	this.sucessPostReq=0;
	this.failedPostReq=0;
	this.callInMinute=0;
	this.mostRecentError="";
	this.mostRecentErrorHash="";
	this.activeConn=0;


	this.client = redis.createClient('6379', '127.0.0.1');
	this.client2 = redis.createClient('6379', '127.0.0.1');
	this.UpdateRedis = redis.createClient('6379', '127.0.0.1');


	/*
	 Redis lua script to find single element in ordered list by timestamp, that time in past
	 check if delivery attempts not exceeds what in config, remove from set otherwise, add to abandoned calls
	 */

	this.script=
		'\		local function processQueue()\
		\ 			local newHash = redis.call("zrangebyscore", "sQue", 5,ARGV[1],"limit",0,2)\
		\			local returnValue={}\
		\ \
		\			if(newHash[1]~=nil) then\
		\				local timeAndCount = redis.call("hmget",newHash[1],"count","load")\
		\ \
		\				if(timeAndCount[1]~=false) then\
		\ \
		\						if (timeAndCount[1]>ARGV[2]) then\
		\								redis.call("zrem","sQue",newHash[1])\
		\								redis.call("incrby","undeliverableCalls",1)\
		\								redis.call("sadd","abandonedList",newHash[1])\
		\								returnValue=({"next","record found, but counter exceeded,skip next"})\
		\ \
		\						else\
		\ 								local postBody=timeAndCount[2]\
		\								local recordDeliveryAttemptCount=timeAndCount[1]\
		\ \
		\ 								redis.call("ZADD","sQue",ARGV[3],newHash[1])\
		\ 								returnValue=({"process",newHash[1],postBody,recordDeliveryAttemptCount,newHash[2],"found, counter good, ready to process, set timescore to tolerate client crash"})\
		\ \
		\						end\
		\ \
		\ 				elseif(timeAndCount[1]==false) then\
		\ \
		\ 						redis.call("zrem","sQue",newHash[1])\
		\ 						returnValue= ({"next","record found in sorted list but keys deleted, remove from sorted then. May occur if flushall issued in redis, during bulk insertion"})\
		\ \
		\ 				end\
		\ \
		\			else\
		\				returnValue=({"subscribe"})\
		\			end\
		\ \
		\			if(returnValue[1]=="next") then\
		\				return processQueue()\
		\ \
		\			else\
		\				return (returnValue)\
		\ \
		\			end\
		\ \
		\ 		end\
		\ \
		\		local returString=processQueue()\
		\ \
		\		if(returString[1]=="process") then\
		\			return ({returString[1],returString[2],returString[3],returString[4],returString[5]})\
		\ \
		\		elseif(returString[1]=="subscribe") then\
		\			return (returString)\
		\ \
		\		end';

	//calculating SHA1 for Redis evalsha
	this.shasum = crypto.createHash('sha1');
	this.shasum.update(this.script);
	this.scriptSha=this.shasum.digest('hex');



	Consumer.prototype.ShutDown= function() {
		console.log("Received kill signal, shutting down gracefully.");
		self.shutingDown=true;

		setTimeout(function(){
			console.log("Closed out remaining connections.");
			process.exit();
		//},self.config['responseTimeOut']*1000+5000); //todo in production after testing
		},self.config['responseTimeOut']*100);

	}

	// save shutdown
	process.on ('SIGTERM', self.ShutDown);
	process.on ('SIGINT', self.ShutDown);

	Consumer.prototype.Cluster= function () {
		console.log('Starting Cluster Mode App');
		if (cluster.isMaster) {
			for (var i = 0; i < self.config['numCPUs']; i++) {
				cluster.fork();
			}
		} else {
			// Subscribe to redis sub/pub to receive update notification

			self.client.on("subscribe", function (channel, count) {});

			self.client.on("message", function (channel, message) {
				console.log('new message');

				// After acknowledged, stop listening for updates and proceed with fetching script, Will resubscribe if no new record found.
				self.client.unsubscribe();
				self.prepFetchTask();
			});

			// initial subcription call
			self.client.subscribe("queue");
		}
	}

	Consumer.prototype.nonCluster= function () {
		console.log('Starting Single Threaded App');

		//Subscribe to redis sub/pub to receive update notification
		self.client.on("subscribe", function (channel, count) {});

		self.client.on("message", function (channel, message) {
			console.log('new message');
			// After acknowledged, stop listening for updates and proceed with fetching script, Will resubscribe if no new record found.

			self.client.unsubscribe();
			self.prepFetchTask();
		});

		// initial subcription call
		self.client.subscribe("queue");
	}



	Consumer.prototype.start = function (BenchMark,refreshInterval) {

		if(self.config['enableCluster']){
			self.Cluster();
		}else{
			self.nonCluster();
		}

		if(BenchMark){
			self.showBenchmark(refreshInterval);
		}

		//safe call function, to check if script stay subscribed
		self.confirmSubscription();
	}

	Consumer.prototype.confirmSubscription = function (refreshInterval) {
		setInterval(function(){
				if(self.activeConn<=0 && self.shutingDown===false && self.client.pub_sub_mode===false){
					self.client.subscribe("queue");
				}
		},60*1000);
	}

	Consumer.prototype.showBenchmark = function (refreshInterval) {

		var intervall=refreshInterval;

		setInterval(function(){

			console.log('Statistical Data Per Session:');
			console.log('');
			console.log('');
			console.log('Session Started: '+ new Date(parseInt(self.startTime+'000')).toLocaleTimeString());
			console.log('');
			console.log('');
			console.log('');
			console.log('');

			self.startEndMinute=Math.floor(Date.now() / 1000);

			console.log('Request Per Second: '+Math.floor((self.totalCallsPerSession-self.callInMinute)/(self.startEndMinute-self.startFirstMinute)));
			console.log('Average op/s Since Start: '+Math.floor(self.totalCallsPerSession/(self.startEndMinute-self.startTime)));
			console.log('Active Connections: '+self.activeConn);
			console.log('');
			console.log('');
			console.log('Most Recent Success Record: '+self.mostRecentSuccessHash);
			//console.log('Most Recent Success: '+self.mostRecentSuccess);
			console.log('');
			console.log('Most Recent Error Record: '+self.mostRecentErrorHash);
			console.log('Most Recent Error: '+self.mostRecentError);
			console.log('');
			console.log('');
			console.log('Total Calls in Session: '+self.totalCallsPerSession);
			console.log('Success Calls: '+self.successCounter);
			console.log('Failed Calls: '+self.failedCounter);
			console.log('');
			console.log('');
			console.log('GET Request: '+self.sessionGetReq);
			console.log('GET Request Succeed: '+self.succesGetReq);
			console.log('GET Request Failed: '+self.failedGetReq);
			console.log('');
			console.log('');
			console.log('POST Request: '+self.sessionPostReq);
			console.log('POST Request Succeed: '+self.sucessPostReq);
			console.log('POST Request Failed: '+self.failedPostReq);

			this.startFirstMinute=Math.floor(Date.now() / 1000);

			self.callInMinute=self.totalCallsPerSession;

		},intervall*1000);

	}


	Consumer.prototype.prepFetchTask = function () {
		//console.log('ddd');
		/*
			Task manager, fetching new records from system, and sending further to be delivered or if not found, resubscribe to pub/sub
		 */

		var time=Math.floor(Date.now() / 1000);
		var count=self.config['deliveryAttempts'].length;
		var ttl=time+self.config['crashTimeOut']; //configurable response timeout, if pass that and still there considered as consumer crashed and will be re-qued
		var abandonedCallExpireIn=self.config['expireAbandonedCalls'];

		var args=[self.script,'',time,count,ttl,abandonedCallExpireIn];
		var argsSha=[self.scriptSha,'',time,count,ttl,abandonedCallExpireIn];

		//try use cached scrypt, save bandwith
		self.client2.evalsha(argsSha, function(err, reply) {

			if(reply!=undefined){

				//if not exceeded concurrent connection and not going down, then try to call itself to check if new record found

				if(self.activeConn<self.config['activeConnections'] && self.shutingDown===false && reply[0]=="process"){
					self.prepFetchTask();
				}
				self.activeConn++;

				//do the same after callback
				self.processReply(reply,function(){
					self.activeConn--;
					if(self.activeConn<self.config['activeConnections'] && self.shutingDown===false && reply[0]=="process"){
						self.prepFetchTask();
					}
					if(self.shutingDown===false && self.activeConn<=0 && !self.client.pub_sub_mode && reply[0]=="subscribe"){
						self.client.subscribe("queue");
					}
				});
			}else{

				self.client2.eval(args, function(err, reply) {

					//if not exceeded concurrent connection and not going down, then try to call itself to check if new record found
					if(self.activeConn<self.config['activeConnections'] && self.shutingDown===false && reply[0]=="process"){
						self.prepFetchTask();
					}
					self.activeConn++;

					//do the same after callback
					self.processReply(reply,function(){
						self.activeConn--;

						if(self.activeConn<self.config['activeConnections'] && self.shutingDown===false && reply[0]=="process"){
							self.prepFetchTask();
						}
						if(self.shutingDown===false && self.activeConn<=0 && !self.client.pub_sub_mode && reply[0]=="subscribe"){
							self.client.subscribe("queue");
						}
					});



				})

			}
		});

	}

	Consumer.prototype.processReply = function (reply,callback) {

		if(reply[0]=="process"){
			//console.log('record found and we ready to send request');

			self.prepToSend(reply,function(status){
				if(parseInt(status)==200){
					self.successCounter++;
				}else{
					self.failedCounter++;
				}
				callback();
			});

		}else if(reply[0]=="subscribe"){
			//console.log('no more records to fetch, and last connection will subscribe to que');
			if(self.shutingDown===false && self.activeConn<=0 && !self.client.pub_sub_mode){
				self.client.subscribe("queue");
			}
			callback();

		}else if(reply==undefined){
			//console.log('Should not be here, but if redis overcommit or some crazy stuff.');
			callback();

		}
	}

	Consumer.prototype.prepToSend = function (reply,callback) {
		/*
			Breaking payload apart and submit to POST or GET functions
		 */

		var loadHash=reply[1];
		var loadBody=JSON.parse(reply[2]);
		var attempt=JSON.parse(reply[3]);

		self.totalCallsPerSession++;

		if(loadBody['endpoint']['method'].toLowerCase()=='get'){
			self.sessionGetReq++;

			var postKeys = loadBody['data'];
			var urlWithPlaceholders = loadBody['endpoint']['url'];

			/*
				replacing placeholders with data
				"http://sample_domain_endpoint.com/data?key={key}&value={value}&foo={bar}"		=>
			 	"http://sample_domain_endpoint.com/data?key=Phyllobates&value=Terribilis&foo="
			 */

			loadBody['endpoint']['url'] = urlWithPlaceholders.replace(/{([^}]+)}/gi, function(placeholder) {
				var key=placeholder.substring(1,placeholder.length-1);
				return postKeys[key] || self.config['unknownKeyValue'];
			});

			self.getReqSend(loadBody,function(statusCode,body,deliveryAttempt){
				var responseFinished=Math.floor(Date.now() / 1000);

				if(parseInt(statusCode)==200){
					self.mostRecentSuccess=body;
					self.mostRecentSuccessHash=loadHash;
					self.succesGetReq++;
				}else{
					self.mostRecentError=body;
					self.mostRecentErrorHash=loadHash;
					self.failedGetReq++;
				}
				self.updateRedisRecord('GET',loadHash,statusCode,body,deliveryAttempt,responseFinished);
				callback(statusCode)
			});
		}

		if(loadBody['endpoint']['method'].toLowerCase()=='post'){
			//data from payload send with POST
			self.sessionPostReq++;

			self.postReqSend(loadBody,function(statusCode,body,deliveryAttempt){
				var responseFinished=Math.floor(Date.now() / 1000);

				if(parseInt(statusCode)==200){
					self.mostRecentSuccess=body;
					self.mostRecentSuccessHash=loadHash;
					self.sucessPostReq++;
				}else{
					self.mostRecentError=body;
					self.mostRecentErrorHash=loadHash;
					self.failedPostReq++;
				}

				self.updateRedisRecord('POST',loadHash,statusCode,body,deliveryAttempt,responseFinished);
				callback(statusCode)
			});
		}
	}

	Consumer.prototype.updateRedisRecord = function (typeReq,loadHash,statusCode,body,deliveryAttempt,responseFinished) {

		/*
			little worker to update Redis record with:
			3) Log delivery time, response code, response time, and response body.
			and if failed, schedule redelivery
		 */
			var multi = self.UpdateRedis.multi();

			multi.hset(loadHash, 'statusCode',statusCode);
			multi.hset(loadHash, 'responseBody',body);
			multi.hset(loadHash, 'deliveryAttempt',deliveryAttempt);
			multi.hset(loadHash, 'responseFinished',responseFinished);
			multi.incrby('redisProcessed',1);

				if(parseInt(statusCode)==200){
					multi.incrby("successCalls", 1);
					multi.zrem('sQue',loadHash);
					multi.sadd('successList',loadHash);
				}else{
					multi.incrby("failedCalls", 1);
					multi.sadd('failedList',loadHash);
					multi.hincrby(loadHash, 'count',1);
					multi.zadd('sQue',responseFinished+self.config['deliveryAttempts'][deliveryAttempt],loadHash);
				}

			multi.exec(function (err, replies) {
			});
	}

	Consumer.prototype.getReqSend = function (loadBody,callback) {
		//GET request routine

		var parsedURL=url.parse(loadBody['endpoint']['url']);

		var options = {
			host: parsedURL['hostname'],
			path:'/tst.php',
			//path: parsedURL['path'],
			agent: false
		};
		var deliveryT=Math.floor(Date.now() / 1000);

		var req = http.get(options, function(res) {

			var body = '';
			res.on('data', function (chunk) {
				body += chunk;
			});
			res.on('end', function() {
				callback(res.statusCode,body,deliveryT);
			})

			})

			.on('error', function(e) {
				//console.log(e);
				callback('500',JSON.stringify(e),deliveryT);

			})

			req.setTimeout(self.config['responseTimeOut']*1000, function(){
				req.abort();
			});
	}


	Consumer.prototype.postReqSend = function (loadBody,callback) {
		//POST request routine

		var parsedURL=url.parse(loadBody['endpoint']['url']);

		var payLoad=JSON.stringify({'data':loadBody['data']});

		var options = {
			hostname: parsedURL['hostname'],
			//path: parsedURL['path'],
			path:'/tst.php',
			method: 'POST',
			agent: false,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': payLoad.length
			}
		};

		var deliveryT=Math.floor(Date.now() / 1000);
		var req = http.request(options, function(res) {
				var body = '';
				res.setEncoding('utf8');

				res.on('data', function (chunk) {
					body += chunk;
				});
				res.on('end', function() {
					callback(res.statusCode,body,deliveryT);
				})
			})
			.on('error', function(e) {
				callback('500',JSON.stringify(e),deliveryT);
			});

		req.write(payLoad);
		req.end();

		req.setTimeout(self.config['responseTimeOut']*1000, function(){
			req.abort();
		});
	}
}


module.exports = Consumer;