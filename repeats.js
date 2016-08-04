class RepeatHandler {
	constructor() {
		this.repeats = [];
		this.deletePending = [];

		this.repeater = setInterval(() => this.runRepeats(), 5000);
	}

	newRepeat(room, message, times, interval) {
		var obj = {
			room: room,
			msg: message,
			times: times,
			interval: interval
		};
		
		if (this.queue) {
			this.queue.push(obj);
		} else {
			this.repeats.push(obj);
		}
	}

	clearRepeat(room, message) {
		if (this.queue) {
			this.deletePending.push({room: room, message: message});
			return;
		}

		this.queue = [];
		var newRepeats = [];
		
		var found = false;
		
		for (var i = 0; i < this.repeats.length; i++) {
			var obj = this.repeats[i];

			if (obj.room === room && (!message || obj.msg === message)) {
			    found = true;
			    continue;
			}
			
			newRepeats.push(obj);
		}

		this.repeats = newRepeats.concat(this.queue);
		this.queue = null;
		
		if (found) {
		    Parse.say(room, "Succesfully cleared repeats.");
		} else {
		    Parse.say(room, "Could not find repeats to clear.");
		}

		if (this.deletePending.length) {
			var val = this.deletePending.splice(0, 1)[0];
			this.clearRepeat(val.room, val.message);
		}
	}

	runRepeats() {
		this.queue = [];
		
		var now = Date.now();
		var newRepeats = [];
		
		for (var i = 0; i < this.repeats.length; i++) {
			var obj = this.repeats[i];

			if (!obj.times) continue;

			if (!obj.next || obj.next <= now) {
				Parse.say(obj.room, obj.msg);
				
				obj.times--;
				obj.next = now + (obj.interval * 1000 * 60);
			}

			newRepeats.push(obj);
		}

		this.repeats = newRepeats.concat(this.queue);
		this.queue = null;

		if (this.deletePending.length) {
			var val = this.deletePending.splice(0, 1)[0];
			this.clearRepeat(val.room, val.message);
		}
	}
}

module.exports = new RepeatHandler();