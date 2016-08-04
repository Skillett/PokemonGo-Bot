/**
 * This is the file where the bot commands are located
 *
 * @license MIT license
 */

/* global Config, toId */

const cpData = require("./cp.js");
const cpMaxData = require("./cpmax.js");
const pokedexData = require("./pokedex.js");

var http = require('http');

var repeats = require('./repeats.js');

if (Config.serverid === 'showdown') {
	var https = require('https');
	var csv = require('csv-parse');
}

// .set constants
const CONFIGURABLE_COMMANDS = {
	say: true,
	joim: true,
	go: true,
	evo: true,
	max: true,
	caprate: true
};
const CONFIGURABLE_MODERATION_OPTIONS = {
	flooding: true,
	caps: true,
	stretching: true,
	bannedwords: false
};

const CONFIGURABLE_COMMAND_LEVELS = {
	off: false,
	disable: false,
	'false': false,
	on: true,
	enable: true,
	'true': true
};

for (let i in Config.groups) {
	if (i !== ' ') CONFIGURABLE_COMMAND_LEVELS[i] = i;
}

exports.commands = {
	/**
	 * Help commands
	 *
	 * These commands are here to provide information about the bot.
	 */

	credits: 'about',
	about: function(arg, user, room) {
		var text = (room === user || user.hasRank(room.id, '#')) ? '' : '/pm ' + user.id + ', ';
		text += '**Pokémon Showdown Bot** Modified for the Pokemon Go room by Skillett';
		this.say(room, text);
	},
	git: function(arg, user, room) {
		var text = (room === user || user.isExcepted()) ? '' : '/pm ' + user.id + ', ';
		text += '**Pokemon Showdown Bot** source code: ' + Config.fork;
		this.say(room, text);
	},
	help: 'guide',
	guide: function(arg, user, room) {
		var text = (room === user || user.hasRank(room.id, '+', '%', '@', '#')) ? '' : '/pm ' + user.id + ', ';
		if (Config.botguide) {
			text += 'A guide on how to use this bot can be found here: ' + Config.botguide;
		}
		else {
			text += 'Null';
		}
		this.say(room, text);
	},
	/**
	 * Dev commands
	 *
	 * These commands are here for highly ranked users (or the creator) to use
	 * to perform arbitrary actions that can't be done through any other commands
	 * or to help with upkeep of the bot.
	 */

	reload: function(arg, user, room) {
		if (!user.isExcepted()) return false;
		try {
			this.uncacheTree('./commands.js');
			Commands = require('./commands.js').commands;
			this.say(room, 'Commands reloaded.');
		}
		catch (e) {
			error('failed to reload: ' + e.stack);
		}
	},
	uptime: function(arg, user, room) {
		var text = ((room === user || user.isExcepted()) ? '' : '/pm ' + user.id + ', ') + '**Uptime:** ';
		var divisors = [52, 7, 24, 60, 60];
		var units = ['week', 'day', 'hour', 'minute', 'second'];
		var buffer = [];
		var uptime = ~~(process.uptime());
		do {
			let divisor = divisors.pop();
			let unit = uptime % divisor;
			buffer.push(unit > 1 ? unit + ' ' + units.pop() + 's' : unit + ' ' + units.pop());
			uptime = ~~(uptime / divisor);
		} while (uptime);

		switch (buffer.length) {
			case 5:
				text += buffer[4] + ', ';
				/* falls through */
			case 4:
				text += buffer[3] + ', ';
				/* falls through */
			case 3:
				text += buffer[2] + ', ' + buffer[1] + ', and ' + buffer[0];
				break;
			case 2:
				text += buffer[1] + ' and ' + buffer[0];
				break;
			case 1:
				text += buffer[0];
				break;
		}

		this.say(room, text);
	},
	custom: function(arg, user, room) {
		if (!user.isExcepted()) return false;

		// Custom commands can be executed in an arbitrary room using the syntax
		// ".custom [room] command", e.g., to do !data pikachu in the room lobby,
		// the command would be ".custom [lobby] !data pikachu". However, using
		// "[" and "]" in the custom command to be executed can mess this up, so
		// be careful with them.
		if (arg.indexOf('[') !== 0 || arg.indexOf(']') < 0) {
			return this.say(room, arg);
		}
		var tarRoomid = arg.slice(1, arg.indexOf(']'));
		var tarRoom = Rooms.get(tarRoomid);
		if (!tarRoom) return this.say(room, Users.self.name + ' is not in room ' + tarRoomid + '!');
		arg = arg.substr(arg.indexOf(']') + 1).trim();
		this.say(tarRoom, arg);
	},
	settings: 'set',
	set: function(arg, user, room) {
		if (room === user || !user.hasRank(room.id, '#')) return false;

		var opts = arg.split(',');
		var cmd = toId(opts[0]);
		var roomid = room.id;
		if (cmd === 'm' || cmd === 'mod' || cmd === 'modding') {
			let modOpt;
			if (!opts[1] || !CONFIGURABLE_MODERATION_OPTIONS[(modOpt = toId(opts[1]))]) {
				return this.say(room, 'Incorrect command: correct syntax is ' + Config.commandcharacter + 'set mod, [' +
					Object.keys(CONFIGURABLE_MODERATION_OPTIONS).join('/') + '](, [on/off])');
			}
			if (!opts[2]) return this.say(room, 'Moderation for ' + modOpt + ' in this room is currently ' +
				(this.settings.modding && this.settings.modding[roomid] && modOpt in this.settings.modding[roomid] ? 'OFF' : 'ON') + '.');

			if (!this.settings.modding) this.settings.modding = {};
			if (!this.settings.modding[roomid]) this.settings.modding[roomid] = {};

			let setting = toId(opts[2]);
			if (setting === 'on') {
				delete this.settings.modding[roomid][modOpt];
				if (Object.isEmpty(this.settings.modding[roomid])) delete this.settings.modding[roomid];
				if (Object.isEmpty(this.settings.modding)) delete this.settings.modding;
			}
			else if (setting === 'off') {
				this.settings.modding[roomid][modOpt] = 0;
			}
			else {
				return this.say(room, 'Incorrect command: correct syntax is ' + Config.commandcharacter + 'set mod, [' +
					Object.keys(CONFIGURABLE_MODERATION_OPTIONS).join('/') + '](, [on/off])');
			}

			this.writeSettings();
			return this.say(room, 'Moderation for ' + modOpt + ' in this room is now ' + setting.toUpperCase() + '.');
		}

		if (!(cmd in Commands)) return this.say(room, Config.commandcharacter + '' + opts[0] + ' is not a valid command.');

		var failsafe = 0;
		while (true) {
			if (typeof Commands[cmd] === 'string') {
				cmd = Commands[cmd];
			}
			else if (typeof Commands[cmd] === 'function') {
				if (cmd in CONFIGURABLE_COMMANDS) break;
				return this.say(room, 'The settings for ' + Config.commandcharacter + '' + opts[0] + ' cannot be changed.');
			}
			else {
				return this.say(room, 'Something went wrong. PM Morfent or TalkTakesTime here or on Smogon with the command you tried.');
			}

			if (++failsafe > 5) return this.say(room, 'The command "' + Config.commandcharacter + '' + opts[0] + '" could not be found.');
		}

		if (!opts[1]) {
			let msg = '' + Config.commandcharacter + '' + cmd + ' is ';
			if (!this.settings[cmd] || (!(roomid in this.settings[cmd]))) {
				msg += 'available for users of rank ' + ((cmd === 'autoban' || cmd === 'banword') ? '#' : Config.defaultrank) + ' and above.';
			}
			else if (this.settings[cmd][roomid] in CONFIGURABLE_COMMAND_LEVELS) {
				msg += 'available for users of rank ' + this.settings[cmd][roomid] + ' and above.';
			}
			else {
				msg += this.settings[cmd][roomid] ? 'available for all users in this room.' : 'not available for use in this room.';
			}

			return this.say(room, msg);
		}

		let setting = opts[1].trim();
		if (!(setting in CONFIGURABLE_COMMAND_LEVELS)) return this.say(room, 'Unknown option: "' + setting + '". Valid settings are: off/disable/false, +, %, @, #, &, ~, on/enable/true.');
		if (!this.settings[cmd]) this.settings[cmd] = {};
		this.settings[cmd][roomid] = CONFIGURABLE_COMMAND_LEVELS[setting];

		this.writeSettings();
		this.say(room, 'The command ' + Config.commandcharacter + '' + cmd + ' is now ' +
			(CONFIGURABLE_COMMAND_LEVELS[setting] === setting ? ' available for users of rank ' + setting + ' and above.' :
				(this.settings[cmd][roomid] ? 'available for all users in this room.' : 'unavailable for use in this room.')));
	},
	blacklist: 'autoban',
	ban: 'autoban',
	ab: 'autoban',
	autoban: function(arg, user, room) {
		if (room === user || !user.canUse('autoban', room.id)) return false;
		if (!Users.self.hasRank(room.id, '@')) return this.say(room, Users.self.name + ' requires rank of @ or higher to (un)blacklist.');
		if (!toId(arg)) return this.say(room, 'You must specify at least one user to blacklist.');

		arg = arg.split(',');
		var added = [];
		var illegalNick = [];
		var alreadyAdded = [];
		var whiteListed = [];
		var roomid = room.id;
		for (let u of arg) {
			let tarUser = toId(u);

			if (!tarUser || tarUser.length > 18) {
				illegalNick.push(tarUser);
			}
			else if (Config.whitelist.indexOf(tarUser) >= 0 || Config.excepts.indexOf(tarUser) >= 0) {
				continue;
			}
			else if (!this.blacklistUser(tarUser, roomid)) {
				alreadyAdded.push(tarUser);
			}
			else {
				added.push(tarUser);
				this.say(room, '/roomban ' + tarUser + ', Blacklisted user');
			}
		}

		var text = '';
		if (added.length) {
			text += 'User' + (added.length > 1 ? 's "' + added.join('", "') + '" were' : ' "' + added[0] + '" was') + ' added to the blacklist.';
			this.say(room, '/modnote ' + text + ' by user ' + user.name + '.');
			text = '';
			this.writeSettings();
		}
		if (alreadyAdded.length) {
			text += ' User' + (alreadyAdded.length > 1 ? 's "' + alreadyAdded.join('", "') + '" are' : ' "' + alreadyAdded[0] + '" is') + ' already present in the blacklist.';
		}
		if (illegalNick.length) text += (text ? ' All other' : 'All') + ' users had illegal nicks and were not blacklisted.';
		this.say(room, text);
	},
	unblacklist: 'unautoban',
	unban: 'unautoban',
	unab: 'unautoban',
	unautoban: function(arg, user, room) {
		if (room === user || !user.canUse('autoban', room.id)) return false;
		if (!Users.self.hasRank(room.id, '@')) return this.say(room, Users.self.name + ' requires rank of @ or higher to (un)blacklist.');
		if (!toId(arg)) return this.say(room, 'You must specify at least one user to unblacklist.');

		arg = arg.split(',');
		var removed = [];
		var notRemoved = [];
		var roomid = room.id;
		for (let u of arg) {
			let tarUser = toId(u);
			if (!tarUser || tarUser.length > 18) {
				notRemoved.push(tarUser);
			}
			else if (!this.unblacklistUser(tarUser, roomid)) {
				notRemoved.push(tarUser);
			}
			else {
				removed.push(tarUser);
				this.say(room, '/roomunban ' + tarUser);
			}
		}

		var text = '';
		if (removed.length) {
			text += ' User' + (removed.length > 1 ? 's "' + removed.join('", "') + '" were' : ' "' + removed[0] + '" was') + ' removed from the blacklist';
			this.say(room, '/modnote ' + text + ' by user ' + user.name + '.');
			this.writeSettings();
		}
		if (notRemoved.length) text += (text.length ? ' No other' : 'No') + ' specified users were present in the blacklist.';
		this.say(room, text);
	},
	rab: 'regexautoban',
	regexautoban: function(arg, user, room) {
		if (room === user || !user.isRegexWhitelisted() || !user.canUse('autoban', room.id)) return false;
		if (!Users.self.hasRank(room.id, '@')) return this.say(room, Users.self.name + ' requires rank of @ or higher to (un)blacklist.');
		if (!arg) return this.say(room, 'You must specify a regular expression to (un)blacklist.');

		try {
			new RegExp(arg, 'i');
		}
		catch (e) {
			return this.say(room, e.message);
		}

		if (/^(?:(?:\.+|[a-z0-9]|\\[a-z0-9SbB])(?![a-z0-9\.\\])(?:\*|\{\d+\,(?:\d+)?\}))+$/i.test(arg)) {
			return this.say(room, 'Regular expression /' + arg + '/i cannot be added to the blacklist. Don\'t be Machiavellian!');
		}

		var regex = '/' + arg + '/i';
		if (!this.blacklistUser(regex, room.id)) return this.say(room, '/' + regex + ' is already present in the blacklist.');

		var regexObj = new RegExp(arg, 'i');
		var users = room.users.entries();
		var groups = Config.groups;
		var selfid = Users.self.id;
		var selfidx = groups[room.users.get(selfid)];
		for (let u of users) {
			let userid = u[0];
			if (userid !== selfid && regexObj.test(userid) && groups[u[1]] < selfidx) {
				this.say(room, '/roomban ' + userid + ', Blacklisted user');
			}
		}

		this.writeSettings();
		this.say(room, '/modnote Regular expression ' + regex + ' was added to the blacklist by user ' + user.name + '.');
		this.say(room, 'Regular expression ' + regex + ' was added to the blacklist.');
	},
	unrab: 'unregexautoban',
	unregexautoban: function(arg, user, room) {
		if (room === user || !user.isRegexWhitelisted() || !user.canUse('autoban', room.id)) return false;
		if (!Users.self.hasRank(room.id, '@')) return this.say(room, Users.self.name + ' requires rank of @ or higher to (un)blacklist.');
		if (!arg) return this.say(room, 'You must specify a regular expression to (un)blacklist.');

		arg = '/' + arg.replace(/\\\\/g, '\\') + '/i';
		if (!this.unblacklistUser(arg, room.id)) return this.say(room, '/' + arg + ' is not present in the blacklist.');

		this.writeSettings();
		this.say(room, '/modnote Regular expression ' + arg + ' was removed from the blacklist user by ' + user.name + '.');
		this.say(room, 'Regular expression ' + arg + ' was removed from the blacklist.');
	},
	viewbans: 'viewblacklist',
	vab: 'viewblacklist',
	viewautobans: 'viewblacklist',
	viewblacklist: function(arg, user, room) {
		if (room === user || !user.canUse('autoban', room.id)) return false;

		var text = '/pm ' + user.id + ', ';
		if (!this.settings.blacklist) return this.say(room, text + 'No users are blacklisted in this room.');

		var roomid = room.id;
		var blacklist = this.settings.blacklist[roomid];
		if (!blacklist) return this.say(room, text + 'No users are blacklisted in this room.');

		if (!arg.length) {
			let userlist = Object.keys(blacklist);
			if (!userlist.length) return this.say(room, text + 'No users are blacklisted in this room.');
			return this.uploadToHastebin('The following users are banned from ' + roomid + ':\n\n' + userlist.join('\n'), function(link) {
				if (link.startsWith('Error')) return this.say(room, text + link);
				this.say(room, text + 'Blacklist for room ' + roomid + ': ' + link);
			}.bind(this));
		}

		var nick = toId(arg);
		if (!nick || nick.length > 18) {
			text += 'Invalid username: "' + nick + '".';
		}
		else {
			text += 'User "' + nick + '" is currently ' + (blacklist[nick] || 'not ') + 'blacklisted in ' + roomid + '.';
		}
		this.say(room, text);
	},
	banphrase: 'banword',
	banword: function(arg, user, room) {
		arg = arg.trim().toLowerCase();
		if (!arg) return false;

		var tarRoom = room.id;
		if (room === user) {
			if (!user.isExcepted()) return false;
			tarRoom = 'global';
		}
		else if (user.canUse('banword', room.id)) {
			tarRoom = room.id;
		}
		else {
			return false;
		}

		var bannedPhrases = this.settings.bannedphrases ? this.settings.bannedphrases[tarRoom] : null;
		if (!bannedPhrases) {
			if (bannedPhrases === null) this.settings.bannedphrases = {};
			bannedPhrases = (this.settings.bannedphrases[tarRoom] = {});
		}
		else if (bannedPhrases[arg]) {
			return this.say(room, 'Phrase "' + arg + '" is already banned.');
		}
		bannedPhrases[arg] = 1;

		this.writeSettings();
		this.say(room, 'Phrase "' + arg + '" is now banned.');
	},
	unbanphrase: 'unbanword',
	unbanword: function(arg, user, room) {
		var tarRoom;
		if (room === user) {
			if (!user.isExcepted()) return false;
			tarRoom = 'global';
		}
		else if (user.canUse('banword', room.id)) {
			tarRoom = room.id;
		}
		else {
			return false;
		}

		arg = arg.trim().toLowerCase();
		if (!arg) return false;
		if (!this.settings.bannedphrases) return this.say(room, 'Phrase "' + arg + '" is not currently banned.');

		var bannedPhrases = this.settings.bannedphrases[tarRoom];
		if (!bannedPhrases || !bannedPhrases[arg]) return this.say(room, 'Phrase "' + arg + '" is not currently banned.');

		delete bannedPhrases[arg];
		if (Object.isEmpty(bannedPhrases)) {
			delete this.settings.bannedphrases[tarRoom];
			if (Object.isEmpty(this.settings.bannedphrases)) delete this.settings.bannedphrases;
		}

		this.writeSettings();
		this.say(room, 'Phrase "' + arg + '" is no longer banned.');
	},
	viewbannedphrases: 'viewbannedwords',
	vbw: 'viewbannedwords',
	viewbannedwords: function(arg, user, room) {

		var tarRoom = room.id;
		var text = '';
		var bannedFrom = '';
		if (room === user) {
			if (!user.isExcepted()) return false;
			tarRoom = 'global';
			bannedFrom += 'globally';
		}
		else if (user.canUse('banword', room.id)) {
			text += '/pm ' + user.id + ', ';
			bannedFrom += 'in ' + room.id;
		}
		else {
			return false;
		}

		if (!this.settings.bannedphrases) return this.say(room, text + 'No phrases are banned in this room.');
		var bannedPhrases = this.settings.bannedphrases[tarRoom];
		if (!bannedPhrases) return this.say(room, text + 'No phrases are banned in this room.');

		if (arg.length) {
			text += 'The phrase "' + arg + '" is currently ' + (bannedPhrases[arg] || 'not ') + 'banned ' + bannedFrom + '.';
			return this.say(room, text);
		}

		var banList = Object.keys(bannedPhrases);
		if (!banList.length) return this.say(room, text + 'No phrases are banned in this room.');

		this.uploadToHastebin('The following phrases are banned ' + bannedFrom + ':\n\n' + banList.join('\n'), function(link) {
			if (link.startsWith('Error')) return this.say(room, link);
			this.say(room, text + 'Banned phrases ' + bannedFrom + ': ' + link);
		}.bind(this));
	},
	seen: function(arg, user, room) { // this command is still a bit buggy
		var text = (room === user ? '' : '/pm ' + user.id + ', ');
		arg = toId(arg);
		if (!arg || arg.length > 18) return this.say(room, text + 'Invalid username.');
		if (arg === user.id) {
			text += 'Have you looked in the mirror lately?';
		}
		else if (arg === Users.self.id) {
			text += 'You might be either blind or illiterate. Might want to get that checked out.';
		}
		else if (!this.chatData[arg] || !this.chatData[arg].seenAt) {
			text += 'The user ' + arg + ' has never been seen.';
		}
		else {
			text += arg + ' was last seen ' + this.getTimeAgo(this.chatData[arg].seenAt) + ' ago' + (
				this.chatData[arg].lastSeen ? ', ' + this.chatData[arg].lastSeen : '.');
		}
		this.say(room, text);
	},
	go: function(arg, user, room) {
		// links to relevant sites for the Wifi room 
		if (Config.serverid !== 'showdown') return false;

		var text = '';
		var text2 = '';
		if (room.id === 'pokemongo') {
			if (!user.canUse('pokemongo', room.id)) {
				text += '/msg ' + user.name + ', Please PM me commands instead of using them in chat!';
				return this.say(room, text);
			}

		}

		arg = arg.split(' ');
		var msgType = toId(arg[0]);
		if (!msgType) return this.say(room, text + 'Welcome to the Pokemon Go Room! Helpful links and bot commands can be found here: https://docs.google.com/document/d/1ti_cppuQtTHibqOKInYZWm_PPBfkPWiPCyqOs-4PoGo/edit');

		msgType = msgType.toLowerCase();

		switch (msgType) {
			case 'eevee':
				return this.say(room, text + 'It is possible to choose whether your Eevee evolves into Vaporeon, Flareon, or Jolteon by nicknaming your Eevee "Rainer", "Pyro", and "Sparky" respectively. Note that this only works once per Eeveelution. ');
			case 'welcome':
			case 'bg':
			case 'beginnersguide':
				return this.say(room, text + 'Beginner\'s guide: http://www.pokemongodb.net/2016/05/pokemon-go-beginners-guide.html');
			case 'el':
			case 'eggs':
			case 'egglist':
				return this.say(room, text + 'Egg List: http://i.imgur.com/4CdFe5n.png');
			case 'maxcp':
			case 'cp':
				return this.say(room, text + 'Pokemon ordered by combat power: http://www.ign.com/wikis/pokemon-go/Pokemon_Max_CP');
			case 'iv':
			case 'ivs':
			case 'ivcalc':
				return this.say(room, text + 'IV Calculators: https://pokeassistant.com/main/ivcalculator  or https://thesilphroad.com/research');
			case 'sr':
			case 'silphroad':
				return this.say(room, text + 'From IV calcs to move viability, find it all on https://thesilphroad.com/research');
			case 'servers':
			case 'server':
				return this.say(room, text + 'Pokemon Go server status: https://go.jooas.com/');
			case 'support':
				return this.say(room, text + 'Pokemon Go Support: https://support.pokemongo.nianticlabs.com/hc/en-us');
			case 'tiers':
			case 'tier':
				return this.say(room, text + 'NEW Tier List - Pokemon Go weighted rankings: https://docs.google.com/spreadsheets/d/1PiBGv76OpeaW95r-5x3xbK5suWFDSXE5Zweq9j7kKhs/htmlview#');
			case 'nerfs':
			case 'buffs':
			case 'balance':
				return this.say(room, text + 'Explains the latest move updates (Android version 0.31.0|IOS version 1.1.0): https://www.reddit.co/TheSilphRoad/comments/4v99uo/move_powers_have_been_updated/');
			case 'moves':
				return this.say(room, text + 'Small infographic showcasing new move damages: http://i.imgur.com/NDBwVTC.jpg');
			case 'tos':
				return this.say(room, text + 'Pokemon GO Terms of Service: https://support.pokemongo.nianticlabs.com/hc/en-us/articles/221993967-Pok%C3%A9mon-GO-Trainer-guidelines')
			default:
				return this.say(room, text + 'Unknown command. If you have an idea for a possible command, shoot a PM to Skillett or fill out this fancy form https://docs.google.com/forms/d/e/1FAIpQLSfNoxiY-HYuvTbdWC6iwGiKRzjBzdzDxxGMrWuldG1CTuJJQg/viewform.');
		}
	},
	js: function(arg, user, room) {
		if (!user.isExcepted()) return false;
		//if (user.id==='ih8ih8sn0w') return false;
		try {
			let result = eval(arg.trim());
			this.say(room, JSON.stringify(result));
		}
		catch (e) {
			this.say(room, e.name + ": " + e.message);
		}
	},
	repeat: function(arg, user, room) {
		if (!user.hasRank(room.id, '%') || !arg) return false; //checks rank and to see if the arg is blank
		var parts = arg.split(","); //rip arrow functions
		//format is in milliseconds. 60,000 = 1 minute. 	
		if (parts.length < 3 || !Number(parts[0]) || !Number(parts[1])) return this.say(room, "the format is .repeat times, interval, text"); // error text if you screw up the command
		repeats.newRepeat(room, parts.slice(2).join(',').trim(), Number(parts[0]), Number(parts[1]));
	},
	clearrepeats: function(arg, user, room) {
		if (!user.hasRank(room.id, '%')) return false; // checks rank and arg isn't blank
		repeats.clearRepeat(room);

	},
	clearrepeat: function(arg, user, room) {
		if (!user.hasRank(room.id, '%') || !arg) return false; // checks rank and arg isn't blank
		repeats.clearRepeat(room, arg);
	},
	htmlbox: function(arg, user, room) {
		room = "pokemongo";
		if (!this.isRanked('#')) return false;
		this.say(room, "/addhtmlbox " + arg);
	},
	evo: function(arg, user, room) {
		if (!arg) return false;
		let parts = arg.split(",").map(function(p) {
			return toId(p);
		});
		let text = "";
		if (!user.canUse('pokemongo', room.id) && !room.hasOwnProperty("rooms")) {
			text = "/msg " + user.name + ", ";
		}
		// check that all the neccesary parts are here
		if (parts.length !== 2 || isNaN(Number(parts[1]))) return this.say(room, text + "The command is .evo [pokemon], [cp]")

		// so first you determine if the pokemon is in the cpData
		if (!cpData.hasOwnProperty(parts[0])) return this.say(room, text + "Invalid Pokémon/Pokémon can't evolve.");

		// next you take the data and build the ranges
		let range = cpData[parts[0]];
		// determine the lower and the higher end of the range by multiplying by the max and the min
		let lowerEnd = Math.round(range[0] * parts[1]);
		let higherEnd = Math.round(range[1] * parts[1]);
		
		// now announce the results
		this.say(room, text + parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + "'s evolution will have a CP (Combat Power) range of: " + lowerEnd + " - " + higherEnd);
	},
	max: function(arg, user, room) {
		if (!arg) return false;
		arg = toId(arg);
		let text = "";
		if (room.id === 'pokemongo') {
			if (!user.canUse('pokemongo', room.id))
			{
				text += '/msg ' + user.name + ', Please PM me commands instead of using them in chat!';
				return this.say(room, text);
			}
		else{
			if (!user.canUse('pokemongo', room.id) && !room.hasOwnProperty("rooms")) {
			text = "/msg " + user.name + ", ";
			}
		}
		}
		// so first you determine if the pokemon is in the cpmaxpData
		if (!cpMaxData.hasOwnProperty(arg)) return this.say(room, text + "Invalid Pokémon");
		
		// now announce the results
		this.say(room, text + arg.charAt(0).toUpperCase() + arg.slice(1) + " has a maximum CP (Combat Power) of: " + cpMaxData[arg][0]);
	},
};
