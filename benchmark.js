/**
 * Author: Sergei Krutov
 * Date: 10/18/15
 * For: kochava test project.
 * Version: 1
 */

var http = require('http');
var redis = require('redis');

var client = redis.createClient('6379', '127.0.0.1');
var dispatcher = require('httpdispatcher');
var nowjs = require('now');
var path = require('path');//helps with file paths
var fs = require('fs');//helps with file system tasks

var url = require('url');
var AvailableConcurrentConnections = 10;

//benchmark counters
var dataReport = {
	'redisReqPerSec': 0,
	'subReqSec': 0,

	'redisReqPerSecBest': 0,
	'subReqSecBest': 0,

	'InitRedisRequestReceived': 0,
	'InitRedisGetCalls': 0,
	'InitRedisPostCalls': 0,
	'InitRedisLoadVol': 0,
	'InitRedisSuccessCalls': 0,
	'InitRedisFailedCalls': 0,
	'InitRedisProcessed': 0,
	'redisBestReqSec': 0,


	'redisRequestReceived': 0,
	'redisGetCalls': 0,
	'redisPostCalls': 0,
	'redisLoadVol': 0,
	'redisSuccessCalls': 0,
	'redisFailedCalls': 0,
	'redisProcessed': 0,

	'postCount': 0,
	'getcount': 0,
	'startScript': Math.floor(Date.now() / 1000),
	'startFirstMinute': Math.floor(Date.now() / 1000),
	'startEndMinute': Math.floor(Date.now() / 1000),
	'postLoadStart': Math.floor(Date.now() / 1000),
	'postLoadStop': Math.floor(Date.now() / 1000),
	'postreqpersec': 0,
	'timeTotalPOSTCallsPerSession': 0,
	'totalPOSTCallsPerSession': 0,

	'getLoadStart': Math.floor(Date.now() / 1000),
	'getLoadStop': Math.floor(Date.now() / 1000),
	'getreqpersec': 0,
	'timeTotalGETCallsPerSession': 0,
	'totalGETCallsPerSession': 0,


	'totalCallsPerSession': 0,
	'reqpersec': 0,
	'callInMinute': 0,
	'successPostCalls': 0,
	'successGetsCalls': 0,
	'failedPostCalls': 0,
	'failedGetsCalls': 0,
	'processedPosts': 0,
	'processedGets': 0
};

//Lets define a port we want to listen to
const PORT = 8081;

//We need a function which handles requests and send response
function handleRequest(request, response) {
	try {
		dispatcher.dispatch(request, response);
	} catch (err) {
		console.log(err);
	}
}

//Create a server
var server = http.createServer(handleRequest);
var everyone = nowjs.initialize(server);

//Lets start our server
server.listen(PORT, function () {
	//http://localhost:8081/benchmark?post=10&get=10
	console.log("Server listening on: http://localhost:%s", PORT);
});

dispatcher.onGet("/jquery.min.js", function (req, res) {
	var
		content = '',
		fileName = path.basename(url.parse(req.url)['pathname']),
		localFolder = __dirname + '/';//where our public files are located

	content = localFolder + fileName;

	fs.readFile(content, function (err, contents) {
		//if the fileRead was successful...
		if (!err) {
			//send the contents of index.html
			//and then close the request
			res.end(contents);
		} else {
			console.dir(err);
		}
	});

});

dispatcher.onGet("/update", function (req, res) {
	//ajax response for update request from index.html
	res.writeHead(200, {'Content-Type': 'application/json'});
	dataReport['startEndMinute'] = Math.floor(Date.now() / 1000);

	var redisReqS = (dataReport['redisProcessed'] - dataReport['InitRedisProcessed']) / (dataReport['startEndMinute'] - dataReport['startFirstMinute']);
	if (redisReqS > dataReport['redisReqPerSecBest']) {
		dataReport['redisReqPerSecBest'] = redisReqS;
	}

	var reqS = Math.floor((dataReport['totalCallsPerSession'] - dataReport['callInMinute']) / (dataReport['startEndMinute'] - dataReport['startFirstMinute']));

	if (reqS > dataReport['subReqSec']) {
		dataReport['subReqSec'] = reqS;
	}


	var data = {

		'reqpersec': reqS,
		'redisReqPerSec': redisReqS,

		'redisReqPerSecBest': dataReport['redisReqPerSecBest'],
		'subReqSecBest': dataReport['subReqSec'],

		'redisSuccessCallsSession': dataReport['redisSuccessCalls'] - dataReport['InitRedisSuccessCalls'],

		'redisRequestReceivedSession': dataReport['redisRequestReceived'] - dataReport['InitRedisRequestReceived'],
		'redisGetCallsSession': dataReport['redisGetCalls'] - dataReport['InitRedisGetCalls'],
		'redisPostCallsSession': dataReport['redisPostCalls'] - dataReport['InitRedisPostCalls'],
		'redisLoadVolSession': dataReport['redisLoadVol'] - dataReport['InitRedisLoadVol'],

		'redisFailedCallsSession': dataReport['redisFailedCalls'] - dataReport['InitRedisFailedCalls'],

		'timeTotalPOSTCallsPerSession': (dataReport['postLoadStop'] - dataReport['postLoadStart']),
		'totalPOSTCallsPerSession': dataReport['totalPOSTCallsPerSession'],
		'postreqpersec': dataReport['totalPOSTCallsPerSession'] / (dataReport['postLoadStop'] - dataReport['postLoadStart']),

		'timeTotalGETCallsPerSession': (dataReport['getLoadStop'] - dataReport['getLoadStart']),
		'totalGETCallsPerSession': dataReport['totalGETCallsPerSession'],
		'getreqpersec': dataReport['totalGETCallsPerSession'] / (dataReport['getLoadStop'] - dataReport['getLoadStart']),

		'totalCallsPerSession': dataReport['totalCallsPerSession'],
		'reqpersec': reqS,
		'processedPosts': dataReport['processedPosts'],
		'successPostCalls': dataReport['successPostCalls'],
		'successGetsCalls': dataReport['successGetsCalls'],
		'failedPostCalls': dataReport['failedPostCalls'],
		'failedGetsCalls': dataReport['failedGetsCalls'],

		'processedGets': dataReport['processedGets']
	};
	dataReport['startFirstMinute'] = Math.floor(Date.now() / 1000);
	dataReport['callInMinute'] = dataReport['totalCallsPerSession'];
	dataReport['InitRedisProcessed'] = dataReport['redisProcessed'];
	res.end(JSON.stringify(data));
});


dispatcher.onGet("/start", function (req, res) {
	// starting whole thing when user submit payload
	res.writeHead(200, {'Content-Type': 'text/plain'});

	var url_parts = url.parse(req.url, true);
	var query = url_parts.query;

	var dest = {
		host: '159.203.110.136', //ingest script location
		path: '/i',

		loadHost: '159.203.110.136', //payload destination
		loadPath: '/test.php'

	};

	//reset counters if resubmit
	dataReport = {
		'redisReqPerSec': 0,
		'subReqSec': 0,

		'redisReqPerSecBest': 0,
		'subReqSecBest': 0,

		'redisRequestReceived': 0,
		'redisGetCalls': 0,
		'redisPostCalls': 0,
		'redisLoadVol': 0,
		'redisSuccessCalls': 0,
		'redisFailedCalls': 0,

		'InitRedisRequestReceived': 0,
		'InitRedisGetCalls': 0,
		'InitRedisPostCalls': 0,
		'InitRedisLoadVol': 0,
		'InitRedisSuccessCalls': 0,
		'InitRedisFailedCalls': 0,

		'InitRedisProcessed': 0,
		'redisProcessed': 0,

		'postCount': 0,
		'getcount': 0,
		'startScript': Math.floor(Date.now() / 1000),
		'startFirstMinute': Math.floor(Date.now() / 1000),
		'startEndMinute': Math.floor(Date.now() / 1000),
		'postLoadStart': Math.floor(Date.now() / 1000),
		'postLoadStop': Math.floor(Date.now() / 1000),
		'postreqpersec': 0,
		'timeTotalPOSTCallsPerSession': 0,
		'totalPOSTCallsPerSession': 0,

		'getLoadStart': Math.floor(Date.now() / 1000),
		'getLoadStop': Math.floor(Date.now() / 1000),
		'getreqpersec': 0,
		'timeTotalGETCallsPerSession': 0,
		'totalGETCallsPerSession': 0,


		'totalCallsPerSession': 0,
		'reqpersec': 0,
		'callInMinute': 0,
		'successPostCalls': 0,
		'successGetsCalls': 0,
		'failedPostCalls': 0,
		'failedGetsCalls': 0,
		'processedPosts': 0,
		'processedGets': 0
	};


	//sync data from redis, for node.js performance
	client.get('requestCount', function (err, reply) {
		dataReport['InitRedisRequestReceived'] = reply;
		dataReport['redisRequestReceived'] = reply;
	});

	client.get('getCalls', function (err, reply) {
		dataReport['InitRedisGetCalls'] = reply;
		dataReport['redisGetCalls'] = reply;
	});

	client.get('postCalls', function (err, reply) {
		dataReport['InitRedisPostCalls'] = reply;
		dataReport['redisPostCalls'] = reply;
	});

	client.get('loadVolume', function (err, reply) {
		dataReport['InitRedisLoadVol'] = reply;
		dataReport['redisLoadVol'] = reply;
	});

	client.get('successCalls', function (err, reply) {
		dataReport['InitRedisSuccessCalls'] = reply;
		dataReport['redisSuccessCalls'] = reply;
	});

	client.get('failedCalls', function (err, reply) {
		dataReport['InitRedisFailedCalls'] = reply;
		dataReport['redisFailedCalls'] = reply;
	});

	client.get('redisProcessed', function (err, reply) {
		dataReport['InitRedisProcessed'] = reply;
		dataReport['redisProcessed'] = reply;
	});


	//console.log(query['posts']);
	var query = url_parts.query;

	if (query['posts'] == undefined || query['gets'] == undefined) {
		res.end('Please provide POST and GET payload volume:\n/benchmark?post=XXX&get=XXX');
	} else {

		if (query['concur'] != "" && query['concur'] > 0) {
			AvailableConcurrentConnections = query['concur'];
		}


		dataReport['postCount'] = query['posts'];
		if (dataReport['postCount'] > 0) {
			dataReport['postLoadStart'] = Math.floor(Date.now() / 1000);
			runningPostInLoop(dest);
		}

		dataReport['getcount'] = query['gets'];
		if (dataReport['getcount'] > 0) {
			dataReport['getLoadStart'] = Math.floor(Date.now() / 1000);
			runningGetInLoop(dest);
		}


		res.end('good');
	}

	redisRefresh();
	//res.end();
});


function redisRefresh() {
	//async refreshing data from redis about app status
	setInterval(function () {
		client.get('requestCount', function (err, reply) {
			dataReport['redisRequestReceived'] = reply
		});

		client.get('getCalls', function (err, reply) {
			dataReport['redisGetCalls'] = reply
		});

		client.get('postCalls', function (err, reply) {
			dataReport['redisPostCalls'] = reply
		});

		client.get('loadVolume', function (err, reply) {
			dataReport['redisLoadVol'] = reply
		});

		client.get('successCalls', function (err, reply) {
			dataReport['redisSuccessCalls'] = reply
		});

		client.get('failedCalls', function (err, reply) {
			dataReport['redisFailedCalls'] = reply
		});

		client.get('redisProcessed', function (err, reply) {
			dataReport['redisProcessed'] = reply;
		});
	}, 1000)
}

function runningGetInLoop(dest) {

	//hack to run requests in parallel with given concurrent connections

	AvailableConcurrentConnections--;
	dataReport['totalCallsPerSession']++;
	dataReport['totalGETCallsPerSession']++;
	dataReport['getcount']--;

	sendGet(dest, function (status, body) {
		dataReport['getLoadStop'] = Math.floor(Date.now() / 1000);
		AvailableConcurrentConnections++;
		dataReport['processedGets']++
		//console.log(body);
		if (parseInt(status) == 200 && body == 'ok') {
			dataReport['successGetsCalls']++;
		} else {
			//console.log('failed');
			//console.log(body);
			dataReport['failedGetsCalls']++;
		}
		if (AvailableConcurrentConnections > 0 && dataReport['getcount'] > 0) {
			runningGetInLoop(dest);
		}

	});

	if (AvailableConcurrentConnections > 0 && dataReport['getcount'] > 0) {
		runningGetInLoop(dest);
	}
}

function runningPostInLoop(dest) {

	//hack to run requests in parallel with given concurrent connections

	AvailableConcurrentConnections--;
	dataReport['totalCallsPerSession']++;
	dataReport['totalPOSTCallsPerSession']++;
	dataReport['postCount']--;

	//for(var i = 0; i < query['posts']; i++) {
	sendPost(dest, function (status, body) {
		dataReport['postLoadStop'] = Math.floor(Date.now() / 1000);
		AvailableConcurrentConnections++;
		dataReport['processedPosts']++
		//console.log(body);
		if (parseInt(status) == 200 && body == 'ok') {
			dataReport['successPostCalls']++;
		} else {
			console.log('failed');
			console.log(body);
			dataReport['failedPostCalls']++;
		}
		if (AvailableConcurrentConnections > 0 && dataReport['postCount'] > 0) {
			runningPostInLoop(dest);
		}

		//res.write('Success Post Calls: '+successPostCalls+'\n Failed Post Calls: '+failedPostCalls);
	});

	if (AvailableConcurrentConnections > 0 && dataReport['postCount'] > 0) {
		runningPostInLoop(dest);
	}
	//}

}


dispatcher.onGet("/benchmark", function (req, res) {
	var
		content = '',
	//fileName ='index.html',//the file that was requested
		fileName = path.basename(url.parse(req.url)['pathname']),
		localFolder = __dirname;//where our public files are located

	content = localFolder + fileName;

	if (fileName === 'benchmark') {
		content = localFolder + '/index.html';

		fs.readFile(content, function (err, contents) {
			//if the fileRead was successful...
			if (!err) {
				//send the contents of index.html
				//and then close the request
				res.end(contents);
			} else {
				//otherwise, let us inspect the eror
				//in the console
				console.dir(err);
			}
			;

			//res.write(contents);
			//res.end();
		});
	}
});


function sendGet(dest, callback) {

	//payload for GET requests

	var payLoad = {
		"endpoint": {
			"method": "GET",
			"url": 'http://' + dest['loadHost']+ dest['loadPath']
		},
		"data": [
			{
				"key": "Azureus",
				"value": "Dendrobates"
			},
			{
				"key": "Phyllobates",
				"value": "Terribilis"
			},
			{
				"key": "Nubeculosus",
				"value": "Dendrobates"
			}
		]
	};

	var payLoad = JSON.stringify(payLoad);

	var options = {
		hostname: dest['host'],
		path: dest['path'],
		method: 'POST',
		agent: false,
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': payLoad.length
		}
	};

	var req = http.request(options, function (res) {
		var body = '';
		res.setEncoding('utf8');
		if (res.statusCode != 200) {
			console.log('failed');
			console.log(body);
		}

		res.on('data', function (chunk) {
			body += chunk;
		});
		res.on('end', function () {
			callback(res.statusCode, body);
		})
	})
		.on('error', function (e) {
			console.log(e);
			callback('500', json_encode(e));
		});

	req.write(payLoad);
	req.end();

	req.setTimeout(100 * 1000, function () {
		req.abort();
	});

}


function sendPost(dest, callback) {

	//payload for POST requests

	var payLoad = {
		"endpoint": {
			"method": "POST",
			"url": 'http://' + dest['loadhost'] + dest['loadPath']
		},
		"data": [
			{
				"key": "Azureus",
				"value": "Dendrobates"
			},
			{
				"key": "Phyllobates",
				"value": "Terribilis"
			},
			{
				"key": "Nubeculosus",
				"value": "Dendrobates"
			}
		]
	};

	var payLoad = JSON.stringify(payLoad);

	var options = {
		hostname: dest['host'],
		path: dest['path'],
		method: 'POST',
		agent: false,
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': payLoad.length
		}
	};

	var req = http.request(options, function (res) {
		var body = '';
		res.setEncoding('utf8');
		if (res.statusCode != 200) {
			console.log('failed');
			console.log(body);
		}

		res.on('data', function (chunk) {
			body += chunk;
		});
		res.on('end', function () {
			callback(res.statusCode, body);
		})
	})
		.on('error', function (e) {
			console.log(e);
			callback('500', json_encode(e));
		});

	req.write(payLoad);
	req.end();

	req.setTimeout(100 * 1000, function () {
		req.abort();
	});

}