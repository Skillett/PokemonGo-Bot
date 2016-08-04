/**
 * This is the file where commands get parsed
 *
 * Some parts of this code are taken from the Pokémon Showdown server code, so
 * credits also go to Guangcong Luo and other Pokémon Showdown contributors.
 * https://github.com/Zarel/Pokemon-Showdown
 *
 * @license MIT license
 */

var fs = require('fs');
var http = require('http');
var https = require('https');
var url = require('url');

const ACTION_COOLDOWN = 3 * 1000;
const FLOOD_MESSAGE_NUM = 5;
const FLOOD_PER_MSG_MIN = 500; // this is the minimum time between messages for legitimate spam. It's used to determine what "flooding" is caused by lag
const FLOOD_MESSAGE_TIME = 6 * 1000;
const MIN_CAPS_LENGTH = 12;
const MIN_CAPS_PROPORTION = 0.8;

// TODO: move to rooms.js
// TODO: store settings by room, not command/blacklists
var settings;
try {
	settings = JSON.parse(fs.readFileSync('settings.json'));
} catch (e) {} // file doesn't exist [yet]
if (!Object.isObject(settings)) settings = {};

exports.parse = {
	actionUrl: url.parse('https://play.pokemonshowdown.com/~~' + Config.serverid + '/action.php'),
	'settings': settings,
	// TODO: handle chatdata in users.js
	chatData: {},
	// TODO: handle blacklists in rooms.js
	blacklistRegexes: {},

	data: function (data) {
		if (data.charAt(0) !== 'a') return false;
		data = JSON.parse(data.substr(1));
		if (Array.isArray(data)) {
			for (let i = 0, len = data.length; i < len; i++) {
				this.splitMessage(data[i]);
			}
		} else {
			this.splitMessage(data);
		}
	},
	splitMessage: function (message) {
		if (!message) return;

		var room = null;
		if (message.indexOf('\n') < 0) return this.message(message, room);

		var spl = message.split('\n');
		if (spl[0].charAt(0) === '>') {
			if (spl[1].substr(1, 10) === 'tournament') return false;
			let roomid = spl.shift().substr(1);
			room = Rooms.get(roomid);
			if (spl[0].substr(1, 4) === 'init') {
				let users = spl[2].substr(7);
				room = Rooms.add(roomid, !Config.rooms.includes(roomid));
				room.onUserlist(users);
				return ok('joined ' + room.id);
			}
		}

		for (let i = 0, len = spl.length; i < len; i++) {
			this.message(spl[i], room);
		}
	},
	message: function (message, room) {
		var spl = message.split('|');
		switch (spl[1]) {
			case 'challstr':
				info('received challstr, logging in...');
				var id = spl[2];
				var str = spl[3];

				var requestOptions = {
					hostname: this.actionUrl.hostname,
					port: this.actionUrl.port,
					path: this.actionUrl.pathname,
					agent: false
				};

				var data;
				if (!Config.pass) {
					requestOptions.method = 'GET';
					requestOptions.path += '?act=getassertion&userid=' + toId(Config.nick) + '&challengekeyid=' + id + '&challenge=' + str;
				} else {
					requestOptions.method = 'POST';
					data = 'act=login&name=' + Config.nick + '&pass=' + Config.pass + '&challengekeyid=' + id + '&challenge=' + str;
					console.log(data);
					requestOptions.headers = {
						'Content-Type': 'application/x-www-form-urlencoded',
						'Content-Length': data.length
					};
				}

				var req = https.request(requestOptions, function (res) {
					res.setEncoding('utf8');
					var data = '';
					res.on('data', function (chunk) {
						data += chunk;
					});
					res.on('end', function () {
						if (data === ';') {
							error('failed to log in; nick is registered - invalid or no password given');
							process.exit(-1);
						}
						if (data.length < 50) {
							error('failed to log in: ' + data);
							process.exit(-1);
						}

						if (data.indexOf('heavy load') !== -1) {
							error('the login server is under heavy load; trying again in one minute');
							setTimeout(function () {
								this.message(message);
							}.bind(this), 60 * 1000);
							return;
						}

						if (data.substr(0, 16) === '<!DOCTYPE html>') {
							error('Connection error 522; trying agian in one minute');
							setTimeout(function () {
								this.message(message);
							}.bind(this), 60 * 1000);
							return;
						}
						
						console.log(data);
						
						try {
							data = JSON.parse(data.substr(1));
							console.log(data);
							if (data.actionsuccess) {
								data = data.assertion;
							} else {
								error('could not log in; action was not successful: ' + JSON.stringify(data));
								process.exit(-1);
							}
						} catch (e) {}
						send('|/trn ' + Config.nick + ',0,'+data);
					}.bind(this));
				}.bind(this));

				req.on('error', function (err) {
					error('login error: ' + err.stack);
				});

				if (data) req.write(data);
				req.end();
				break;
			case 'updateuser':
				if (spl[2] !== Config.nick) return;

				if (spl[3] !== '1') {
					error('failed to log in, still guest');
					process.exit(-1);
				}

				ok('logged in as ' + spl[2]);
				send('|/blockchallenges');

				// Now join the rooms
				Rooms.join();

				if (this.settings.blacklist) {
					let blacklist = this.settings.blacklist;
					for (let room in blacklist) {
						this.updateBlacklistRegex(room);
					}
				}
				setInterval(this.cleanChatData.bind(this), 30 * 60 * 1000);
				break;
			case 'c':
				var username = spl[2];
				var user = Users.get(username);
				if (!user) return false; // various "chat" responses contain other data
				if (user === Users.self) return false;
				if (this.isBlacklisted(user.id, room.id)) this.say(room, '/roomban ' + user.id + ', Blacklisted user');

				spl = spl.slice(3).join('|');
				if (!user.hasRank(room.id, '%')) this.processChatData(user.id, room.id, spl);
				this.chatMessage(spl, user, room);
				break;
			case 'c:':
				var username = spl[3];
				var user = Users.get(username);
				if (!user) return false; // various "chat" responses contain other data
				if (user === Users.self) return false;
				if (this.isBlacklisted(user.id, room.id)) this.say(room, '/roomban ' + user.id + ', Blacklisted user');

				spl = spl.slice(4).join('|');
				if (!user.hasRank(room.id, '%')) this.processChatData(user.id, room.id, spl);
				//if (!user.hasRank(room.id, '%')){
				//	this.say(room, '/pm ' + user.id + ', ' + 'Please Pm me commands' );
				//} 
				//else {
				this.chatMessage(spl, user, room);	
				//}
				
				break;
			case 'pm':
				var username = spl[2];
				var user = Users.get(username);
				var group = username.charAt(0);
				if (!user) user = Users.add(username);
				if (user === Users.self) return false;

				spl = spl.slice(4).join('|');
				if (spl.startsWith('/invite ') && user.hasRank(group, '%') &&
						!(toId(spl.substr(8)) === 'lobby' && Config.serverid === 'showdown')) {
					return send('|/join ' + spl.substr(8));
				}
				this.chatMessage(spl, user, user);
				break;
			case 'N':
				var username = spl[2];
				var oldid = spl[3];
				var user = room.onRename(username, oldid);
				if (this.isBlacklisted(user.id, room.id)) this.say(room, '/roomban ' + user.id + ', Blacklisted user');
				this.updateSeen(oldid, spl[1], user.id);
				break;
			case 'J': case 'j':
				var username = spl[2];
				var user = room.onJoin(username, username.charAt(0));
				if (user === Users.self) return false;
				if (this.isBlacklisted(user.id, room.id)) this.say(room, '/roomban ' + user.id + ', Blacklisted user');
				this.updateSeen(user.id, spl[1], room.id);
				break;
			case 'l': case 'L':
				var username = spl[2];
				var user = room.onLeave(username);
				if (user) {
					if (user === Users.self) return false;
					this.updateSeen(user.id, spl[1], room.id);
				} else {
					this.updateSeen(toId(username), spl[1], room.id);
				}
				break;
		}
	},
	chatMessage: function (message, user, room) {
		var cmdrMessage = '["' + room.id + '|' + user.name + '|' + message + '"]';
		message = message.trim();
		if (message.substr(0, Config.commandcharacter.length) !== Config.commandcharacter) return false;

		message = message.substr(Config.commandcharacter.length);
		var index = message.indexOf(' ');
		var arg = '';
		var cmd = message;
		if (index > -1) {
			cmd = cmd.substr(0, index);
			arg = message.substr(index + 1).trim();
		}

		if (!!Commands[cmd]) {
			let failsafe = 0;
			while (typeof Commands[cmd] !== "function" && failsafe++ < 10) {
				cmd = Commands[cmd];
			}
			if (typeof Commands[cmd] === "function") {
				cmdr(cmdrMessage);
				Commands[cmd].call(this, arg, user, room);
			} else {
				error("invalid command type for " + cmd + ": " + (typeof Commands[cmd]));
			}
		}
	},
	say: function (target, text) {
		var targetId = target.id;
		if (Rooms.get(targetId)) {
			send((targetId !== 'lobby' ? targetId : '') + '|' + text);
		} else {
			send('|/pm ' + targetId + ', ' + text);
		}
	},
	isBlacklisted: function (userid, roomid) {
		var blacklistRegex = this.blacklistRegexes[roomid];
		return blacklistRegex && blacklistRegex.test(userid);
	},
	blacklistUser: function (userid, roomid) {
		var blacklist = this.settings.blacklist || (this.settings.blacklist = {});
		if (blacklist[roomid]) {
			if (blacklist[roomid][userid]) return false;
		} else {
			blacklist[roomid] = {};
		}

		blacklist[roomid][userid] = 1;
		this.updateBlacklistRegex(roomid);
		return true;
	},
	unblacklistUser: function (userid, roomid) {
		var blacklist = this.settings.blacklist;
		if (!blacklist || !blacklist[roomid] || !blacklist[roomid][userid]) return false;

		delete blacklist[roomid][userid];
		if (Object.isEmpty(blacklist[roomid])) {
			delete blacklist[roomid];
			delete this.blacklistRegexes[roomid];
		} else {
			this.updateBlacklistRegex(roomid);
		}
		return true;
	},
	updateBlacklistRegex: function (roomid) {
		var blacklist = this.settings.blacklist[roomid];
		var buffer = [];
		for (let entry in blacklist) {
			if (entry.startsWith('/') && entry.endsWith('/i')) {
				buffer.push(entry.slice(1, -2));
			} else {
				buffer.push('^' + entry + '$');
			}
		}
		this.blacklistRegexes[roomid] = new RegExp(buffer.join('|'), 'i');
	},
	  uploadToHastebin: function (toUpload, callback) {
        if (typeof callback !== 'function') return false;
        var reqOpts = {
            hostname: 'hastebin.com',
            method: 'POST',
            path: '/documents'
        };
 
        var req = http.request(reqOpts, function (res) {
            res.on('data', function (chunk) {
                var filename;
                try {
                    filename = JSON.parse(chunk.toString()).key;
                } catch (e) {
                    return callback('Error uploading to Hastebin. this is not the bots fault. its also not the creators fault. do not PM anyone about it. its just hastebin being bad, try again later');
                }
 
                callback('http://hastebin.com/raw/' + filename);
            });
        });
        req.on('error', function (e) {
            callback('Error uploading to Hastebin: this is not the bots fault. its also not the creators fault. do not PM anyone about it. its just hastebin being bad, try again later' + e.message);
        });
 
        req.write(toUpload);
        req.end();
    },
	processChatData: function (userid, roomid, msg) {
		// NOTE: this is still in early stages
		msg = msg.trim().replace(/[ \u0000\u200B-\u200F]+/g, ' '); // removes extra spaces and null characters so messages that should trigger stretching do so
		this.updateSeen(userid, 'c', roomid);
		var now = Date.now();
		if (!this.chatData[userid]) this.chatData[userid] = {
			zeroTol: 0,
			lastSeen: '',
			seenAt: now
		};
		var userData = this.chatData[userid];
		if (!userData[roomid]) userData[roomid] = {
			times: [],
			points: 0,
			lastAction: 0
		};
		var roomData = userData[roomid];

		roomData.times.push(now);

		// this deals with punishing rulebreakers, but note that the bot can't think, so it might make mistakes
		if (Config.allowmute && Users.self.hasRank(roomid, '%') && Config.whitelist.indexOf(userid) < 0) {
			let useDefault = !(this.settings.modding && this.settings.modding[roomid]);
			let pointVal = 0;
			let muteMessage = '';
			let modSettings = useDefault ? null : this.settings.modding[roomid];

			// moderation for banned words
			if ((useDefault || !this.settings.banword[roomid]) && pointVal < 2) {
				let bannedPhraseSettings = this.settings.bannedphrases;
				let bannedPhrases = !!bannedPhraseSettings ? (Object.keys(bannedPhraseSettings[roomid] || {})).concat(Object.keys(bannedPhraseSettings.global || {})) : [];
				for (let bannedPhrase of bannedPhrases) {
					if (msg.toLowerCase().indexOf(bannedPhrase) > -1) {
						pointVal = 2;
						muteMessage = ', Automated response: your message contained a banned phrase';
						break;
					}
				}
			}
			// moderation for flooding (more than x lines in y seconds)
			let times = roomData.times;
			let timesLen = times.length;
			let isFlooding = (timesLen >= FLOOD_MESSAGE_NUM && (now - times[timesLen - FLOOD_MESSAGE_NUM]) < FLOOD_MESSAGE_TIME &&
				(now - times[timesLen - FLOOD_MESSAGE_NUM]) > (FLOOD_PER_MSG_MIN * FLOOD_MESSAGE_NUM));
			if ((useDefault || !('flooding' in modSettings)) && isFlooding) {
				if (pointVal < 4) {
					pointVal = 4;
					muteMessage = ', Automated response: flooding';
				}
			}
			// moderation for caps (over x% of the letters in a line of y characters are capital)
			let capsMatch = msg.replace(/[^A-Za-z]/g, '').match(/[A-Z]/g);
            
			if ((useDefault || !('caps' in modSettings)) && capsMatch && toId(msg).length > MIN_CAPS_LENGTH && (capsMatch.length >= ~~(toId(msg).length * MIN_CAPS_PROPORTION))) {
				if(pointVal < 1)
				{
					pointVal = (capsMatch.length >= 25 ? 3 : 1);
					muteMessage = ',' + (roomData.points === 0 && pointVal == 1 ? ' please don\'t abuse caps.' : ' Automated response: Caps');
				}
			}
			// moderation for stretching (over x consecutive characters in the message are the same)
			var stretchMatch = msg.match(/(.)\1{7,}/gi) || msg.match(/(..+)\1{7,}/gi) || []; // matches the same character (or group of characters) 8 (or 5) or more times in a row
			if ((useDefault || !('stretching' in modSettings)) && stretchMatch.length > 0) {
				if (pointVal < 1) {
					pointVal = (stretchMatch.join('').length >= 25 ? 3 : 1);
					muteMessage = ',' + (roomData.points === 0 && pointVal == 1 ? ' please don\'t stretch.' : ' Automated response: Stretching');
				}
			}

			if (pointVal > 0 && now - roomData.lastAction >= ACTION_COOLDOWN) {
				let cmd = '';
				// defaults to the next punishment in Config.punishVals instead of repeating the same action (so a second warn-worthy
				// offence would result in a mute instead of a warn, and the third an hourmute, etc)
				if (roomData.points >= pointVal && pointVal < 4) {
					roomData.points++;
					cmd = Config.punishvals[roomData.points] || cmd;
				} else { // if the action hasn't been done before (is worth more points) it will be the one picked
					cmd = Config.punishvals[pointVal] || cmd;
					roomData.points = pointVal; // next action will be one level higher than this one (in most cases)
				}
				if (Config.privaterooms.indexOf(roomid) > -1 && cmd === '/warn') cmd = '/mute'; // can't warn in private rooms
				// if the bot has % and not @, it will default to hourmuting as its highest level of punishment instead of roombanning
				if (roomData.points >= 4 && !Users.self.hasRank(roomid, '@')) cmd = '/hourmute';
				// if (userData.zeroTol > 4) { // if zero tolerance users break a rule they get an instant roomban or hourmute
				// 	muteMessage = ', Automated response: zero tolerance user';
				// 	cmd = Users.self.hasRank(roomid, '@') ? '/roomban' : '/hourmute';
				// }
				//if (roomData.points > 1) userData.zeroTol++; // getting muted or higher increases your zero tolerance level (warns do not)
				roomData.lastAction = now;
				this.say(Rooms.get(roomid), cmd + ' ' + userid + muteMessage);
			}
		}
	},
	cleanChatData: function () {
		var chatData = this.chatData;
		for (let user in chatData) {
			for (let room in chatData[user]) {
				let roomData = chatData[user][room];
				if (!Object.isObject(roomData)) continue;

				if (!roomData.times || !roomData.times.length) {
					delete chatData[user][room];
					continue;
				}
				let newTimes = [];
				let now = Date.now();
				let times = roomData.times;
				for (let time of times) {
					if (now - time < 5 * 1000) newTimes.push(time);
				}
				newTimes.sort(function (a, b) {
					return a - b;
				});
				roomData.times = newTimes;
				if (roomData.points > 0 && roomData.points < 4) roomData.points--;
			}
		}
	},

	updateSeen: function (user, type, detail) {
		if (type !== 'n' && Config.rooms.indexOf(detail) < 0 || Config.privaterooms.indexOf(detail) > -1) return;
		var now = Date.now();
		if (!this.chatData[user]) this.chatData[user] = {
			zeroTol: 0,
			lastSeen: '',
			seenAt: now
		};
		if (!detail) return;
		var userData = this.chatData[user];
		var msg = '';
		switch (type) {
		case 'j':
		case 'J':
			msg += 'joining ';
			break;
		case 'l':
		case 'L':
			msg += 'leaving ';
			break;
		case 'c':
		case 'c:':
			msg += 'chatting in ';
			break;
		case 'N':
			msg += 'changing nick to ';
			if (detail.charAt(0) !== ' ') detail = detail.substr(1);
			break;
		}
		msg += detail.trim() + '.';
		userData.lastSeen = msg;
		userData.seenAt = now;
	},
	getTimeAgo: function (time) {
		time = ~~((Date.now() - time) / 1000);

		var seconds = time % 60;
		var times = [];
		if (seconds) times.push(seconds + (seconds === 1 ? ' second': ' seconds'));
		if (time >= 60) {
			time = ~~((time - seconds) / 60);
			let minutes = time % 60;
			if (minutes) times.unshift(minutes + (minutes === 1 ? ' minute' : ' minutes'));
			if (time >= 60) {
				time = ~~((time - minutes) / 60);
				let hours = time % 24;
				if (hours) times.unshift(hours + (hours === 1 ? ' hour' : ' hours'));
				if (time >= 24) {
					let days = ~~((time - hours) / 24);
					if (days) times.unshift(days + (days === 1 ? ' day' : ' days'));
				}
			}
		}
		if (!times.length) return '0 seconds';
		return times.join(', ');
	},
	writeSettings: (function () {
		var writing = false;
		var writePending = false; // whether or not a new write is pending
		var finishWriting = function () {
			writing = false;
			if (writePending) {
				writePending = false;
				this.writeSettings();
			}
		};
		return function () {
			if (writing) {
				writePending = true;
				return;
			}
			writing = true;
			var data = JSON.stringify(this.settings);
			fs.writeFile('settings.json.0', data, function () {
				// rename is atomic on POSIX, but will throw an error on Windows
				fs.rename('settings.json.0', 'settings.json', function (err) {
					if (err) {
						// This should only happen on Windows.
						fs.writeFile('settings.json', data, finishWriting);
						return;
					}
					finishWriting();
				});
			});
		};
	})(),
	uncacheTree: function (root) {
		var uncache = [require.resolve(root)];
		do {
			let newuncache = [];
			for (let i of uncache) {
				if (require.cache[i]) {
					newuncache.push.apply(newuncache,
						require.cache[i].children.map(function (module) {
							return module.filename;
						})
					);
					delete require.cache[i];
				}
			}
			uncache = newuncache;
		} while (uncache.length);
	},
	getDocMeta: function (id, callback) {
		https.get('https://www.googleapis.com/drive/v2/files/' + id + '?key=' + Config.googleapikey, function (res) {
			var data = '';
			res.on('data', function (part) {
				data += part;
			});
			res.on('end', function (end) {
				var json = JSON.parse(data);
				//console.log(data);
				if (json) {
					callback(null, json);
				} else {
					callback('Invalid response', data);
				}
			});
		}).on('error', function (e) {
			callback('Error connecting to Google Docs: ' + e.message);
		});
	},
	
	//
	// TODO: Invesigate. Do we really need 3? Is there a uniform way?
	//
	
	getDocCsv: function (meta, callback) {
		https.get('https://docs.google.com/spreadsheet/pub?key=' + meta.id + '&output=csv', function (res) {
			var data = '';
			res.on('data', function (part) {
				data += part;
			});
			res.on('end', function (end) {
				// console.log(data);
				callback(data);
			});
		}).on('error', function (e) {
			callback('Error connecting to Google Docs: ' + e.message);
		});
	},
	// Older (newer?) documents use this
	getDocCsv2: function (meta, callback) {
		https.get('https://docs.google.com/spreadsheets/d/' + meta.id + '/pub?&output=csv', function (res) {
			var data = '';
			res.on('data', function (part) {
				data += part;
			});
			res.on('end', function (end) {
				// console.log(data);
				callback(data);
			});
		}).on('error', function (e) {
			callback('Error connecting to Google Docs: ' + e.message);
		});
	},
	// I don't even know anymore ;_;
	getDocCsv3: function (meta, callback) {
		//console.log(meta.exportLinks['text/csv']);
		https.get(meta.exportLinks['text/csv'], function (res) {
			var data = '';
			res.on('data', function (part) {
				data += part;
			});
			res.on('end', function (end) {
				// console.log(data);
				callback(data);
			});
		}).on('error', function (e) {
			callback('Error connecting to Google Docs: ' + e.message);
		});
	},
};
