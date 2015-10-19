/**
 * Author: Sergei Krutov
 * Date: 10/18/15
 * For: kochava test project.
 * Version: 1
 */

var Consumer = require('./node.js');

var con = new Consumer();

//where true,10 enable benchmark and set refresh interval
con.start(true,10);
