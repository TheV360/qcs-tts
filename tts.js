'use strict'

// ```js

const TTSSystem = {
	speakUtterance(u) {
		return new Promise((yay, nay) => {
			u.onend = e=>(e.charIndex < e.target.text.length) ? nay(e) : yay()
			u.onerror = e=>nay(e)
			
			speechSynthesis.speak(u)
		})
	},
	
	playSound(s) {
		return new Promise((yay, nay) => {
			let se = s.elem
			
			se.currentTime = 0
			se.volume = ('number'==typeof s.volume) ? s.volume : 1.0
			se.loop = false
			
			let removeListeners = ()=>{ se.onpause = se.onerror = null }
			
			se.onpause = e=>removeListeners((se.currentTime < se.duration) ? nay(e) : yay())
			se.onerror = e=>removeListeners(nay(e))
			
			se.play()
		})
	},
	
	getMessageAuthorName(message, forceNickname = false) {
		let name;
		
		if (forceNickname || message.Author && message.Author.bridge)
			name = message.Author.nickname;
		
		name || (name = message.Author.username);
		
		return name;
	},
	
	getUserParam(message) {
		let k; if (message.Author && message.Author.bridge)
			k = message.Author.nickname || message.values.b
		else
			k = message.createUserId;
		return Object.assign({}, this.userParams[0], this.userParams[k]);
	},
	
	getRoomSettings(room) {
		return Object.assign({}, this.roomSettings[0], this.roomSettings[room]);
	},
	
	lastMessage: {
		room: NaN,
		user: NaN,
		time: NaN,
	},
	
	speakString(message) {
		let utter = new SpeechSynthesisUtterance(String(message));
		let opts = this.userParams[0];
		utter.voice = this.voiceFrom(opts.voice);
		utter.volume = opts.volume;
		utter.pitch = opts.pitch;
		utter.rate = opts.rate;
		this.speakUtteranceBatch([ utter ])
	},
	speakSound(elem) {
		if (!(elem instanceof HTMLAudioElement))
			elem = new Audio(elem);
		this.speakUtteranceBatch([{ elem, volume: this.userParams[0].volume }])
		return elem; // -> so you can cache stuff like placeholderSound
	},
	
	// need to refactor this Now..
	batchFromMessage(message, merged = false) {
		if ('object'!=typeof message) {
			message = { text: String(message), values: { m: 'plaintext' } };
			merged = true;
		}
		
		let tree = Markup.langs.parse(message.text, message.values.m);
		
		let opts = this.getUserParam(message);
		
		if (!merged) {
			opts.nickname || (opts.nickname = this.getMessageAuthorName(message, !!opts.useNickname));
			opts.msg || (opts.msg = `${opts.nickname} says; `);
		}
		
		return { batch: this.renderUtteranceBatch(tree, opts), tag: message.id };
	},
	
	speakMessage(message, merged = false) {
		this.speakUtteranceBatch(this.batchFromMessage(message, merged))
	},
	
	queue: [],
	currentBatch: null,
	currentPart: null,
	
	async speakUtteranceBatch(batch) {
		this.queue.push(batch);
		
		// it may already be speaking. if so, we've already done enough.
		// there's another invocation of this function looping through that
		// block directly below, and it'll get to our addition soon enough.
		if (this.queue.length > 1 || this.currentBatch) return;
		
		while (this.queue.length) {
			try {
				this.currentBatch = this.queue.shift()
				for (let u of this.currentBatch.batch) {
					this.currentPart = u
					if (u instanceof SpeechSynthesisUtterance) await this.speakUtterance(u)
					else if (u.elem instanceof HTMLAudioElement) await this.playSound(u)
				}
			} catch {} finally {
				this.currentBatch = null
				this.currentPart = null
			}
		}
	},
	
	currentNotify: null,
	
	async notifySound(url) {
		if (this.currentNotify)
			this.currentNotify.pause();
		
		let u = { volume: Math.max(0, Math.min(TTSSystem.userParams[0].volume, 1)) };
		
		if (url instanceof HTMLAudioElement) u.elem = url;
		else {
			u.elem = this.notifyMediaCache[url]
			|| (this.notifyMediaCache[url] = new Audio(url));
		}
		
		try {
			this.currentNotify = u;
			await this.playSound(u);
		} catch {} finally {
			this.currentNotify = null;
		}
	},
	
	placeholderSound: null,
	
	userParams: {
		[0]: { // global user params
			voice: null,
			volume: 1,
			pitch: 1,
			rate: 1.25,
		},
		// regretting calling this "params"... should be userSettings maybe
	},
	
	// wait aren't user IDs and room IDs the  same thing
	roomSettings: {
		[0]: { // global room settings
			localAction: 'speak', // either 'none', 'speak', "<url to sound>", or HTMLAudioElement (last one intended only for at runtime)
			globalAction: 'none', // guess.
		},
	},
	
	rubyPronunciationOnly: false,
	renderInsideSpoilers: false, // !!! RISKY
	
	// i mean it works.
	notifyMediaCache: {},
	
	_textReplacements: [],
	clearReplacements() { this._textReplacements = []; },
	replaceText(pattern, replacement, surround = true) {
		if ('string' == typeof pattern) {
			pattern = new RegExp(`\\b${TTSSystem.escapePattern(pattern)}\\b`, 'gi');
			replacement = TTSSystem.escapeReplacement(replacement);
		} else if (pattern instanceof RegExp && !pattern.flags && surround) {
			pattern = new RegExp(`\\b${pattern.source}\\b`, 'gi');
		}
		this._textReplacements.push([pattern, replacement]);
	},
	
	escapePattern(p) { return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },
	escapeReplacement(r) { return r.replace(/\$/g, '$$$$'); },
	
	voiceFrom(name) {
		return speechSynthesis.getVoices().find(v=>v.name.includes(name))
	},
	
	// creates a list of smaller utterances and media to play in sequence
	renderUtteranceBatch(tree, opts = {}) {
		opts.msg || (opts.msg = "")
		
		if ('string'==typeof opts.voice)
			opts.voice = this.voiceFrom(opts.voice)
		
		opts.utter || (opts.utter = [])
		opts.media || (opts.media = {})
		
		let sound = url=>{
			if (!url) return;
			finalizeChunk()
			let u = { volume: Math.max(0, Math.min(opts.volume, 1)) }
			if (url instanceof HTMLAudioElement) u.elem = url;
			else u.elem = opts.media[url] || (opts.media[url] = new Audio(url));
			opts.utter.push(u)
			return u;
		}
		
		let renderWithAltParams = (elem, {volume = 1, pitch = 1, rate = 1})=>{
			let prev = [ opts.volume, opts.pitch, opts.rate ]
			finalizeChunk()
			opts.volume *= volume; opts.pitch *= pitch; opts.rate *= rate
			this.renderUtteranceBatch(elem, opts)
			finalizeChunk()
			;[ opts.volume, opts.pitch, opts.rate ] = prev
		}
		
		// pushes utterance onto the end of the speech queue.
		let finalizeChunk = ()=>{
			opts.msg = opts.msg.trim()
			if (!opts.msg.length) return;
			
			let u = new SpeechSynthesisUtterance(opts.msg)
			u.voice = opts.voice
			u.volume = opts.volume
			u.pitch = opts.pitch
			u.rate = opts.rate
			
			opts.utter.push(u)
			opts.msg = ""
		}
		
		// goofy way to do things
		function simplifyUrl(s) {
			if (s.startsWith("sbs:") || s.includes("://qcs.s")) return "qcs"
			if (s.includes("cdn.discordapp.com/")) return "discord"
			if (s.includes("pbs.twimg.com/")) return "twitter"
			if (s.includes(" ") && !s.includes(".")) return false // silly fake link heuristics
			if (s.includes(" ") && s.includes(".") && s.indexOf(" ") < s.indexOf(".")) return false
			if (s.startsWith('#')) return `anchor "${s.substring(1)}"`
			else try { return new URL(s).hostname.replace("www.", "") }
			catch { return "invalid URL" }
		}
		
		for (let elem of tree.content) {
			if ('string'==typeof elem) {
				this._textReplacements.forEach(([match, replace])=>{
					elem = elem.replaceAll(match, replace)
				});
				
				opts.msg += elem
			} else switch (elem.type) {
				case 'italic': {
					this.renderUtteranceBatch(elem, opts)
				} break;case 'bold': {
					this.renderUtteranceBatch(elem, opts)
				} break;case 'strikethrough': {
					renderWithAltParams(elem, { rate: 1.25, volume: 0.75 })
				} break;case 'underline': {
					this.renderUtteranceBatch(elem, opts)
				} break;case 'video': {
					opts.msg += `\nvideo from ${simplifyUrl(elem.args.url)}\n`
				} break;case 'youtube': {
					opts.msg += "\nyoutube video\n"
				} break;case 'link': {
					// depending on if they're labeled or unlabeled,
					// i treat these as either inline or block respectively.
					// inline being normal space pause, block being sentence break.
					if (elem.content) {
						this.renderUtteranceBatch(elem, opts)
						opts.msg += " (link)"
					} else {
						opts.msg += elem.args.text ? ` ${elem.args.text} (link)` : `\nlink to ${simplifyUrl(elem.args.url)}\n`
					}
				} break;case 'simple_link': {
					let url = simplifyUrl(elem.args.url)
					if (!url) opts.msg += ` ${elem.args.url} (fake link)`
					else opts.msg += elem.args.text ? ` ${elem.args.text} (link)` : `\nlink to ${url}\n`
				} break;case 'image': { // pretty safe bet that all images are block elements
					opts.msg += (elem.args.alt ? `\n${elem.args.alt} (image)` : `\nimage from ${simplifyUrl(elem.args.url)}`) + "\n"
				} break;case 'audio': {
					sound(elem.args.url)
					// todo: time limite for audio?
				} break;case 'code': {
					opts.msg += "\ncode block"
					if (elem.args.lang
					&&  elem.args.lang != 'none'
					&&  elem.args.lang != 'sb') // sign of the times...
						opts.msg += ` written in ${elem.args.lang}`
					opts.msg += "\n"
				} break;case 'icode': {
					opts.msg += elem.args.text
				} break;case 'spoiler': {
					opts.msg += "\nspoiler"
					if (elem.args.label && elem.args.label != 'spoiler')
						opts.msg += ` for ${elem.args.label}`
					if (this.renderInsideSpoilers) {
						opts.msg += ":\n"
						this.renderUtteranceBatch(elem, opts)
						opts.msg += "\n(end spoiler)\n"
					} else {
						opts.msg += "\n"
					}
				} break;case 'heading': {
					renderWithAltParams(elem, { rate: 0.75, volume: 1.25 })
				} break;case 'subscript':case 'superscript':case 'small': {
					renderWithAltParams(elem, { volume: 0.75 })
				} break;case 'quote': {
					opts.msg += "\nquote"
					if (elem.args.cite)
						opts.msg += ` from ${elem.args.cite}`
					opts.msg += ":\n"
					this.renderUtteranceBatch(elem, opts)
					opts.msg += "\n(end quote)\n"
				} break;case 'ruby': {
					// TODO: would it be nice to try swapping the position of language elements if they happen to be inside the ruby? this will require a rewrite of a few parts of this because i wrote this without language in mind, though.
					if (this.rubyPronunciationOnly && elem.args.text && elem.args.text != 'true') {
						opts.msg += elem.args.text
					} else {
						this.renderUtteranceBatch(elem, opts)
						if (elem.args.text)
							opts.msg += ` (${elem.args.text})`
					}
				} break;case 'bg':case 'key':case 'list':case 'anchor': {
					this.renderUtteranceBatch(elem, opts)
				} break;case 'list_item': {
					this.renderUtteranceBatch(elem, opts)
					opts.msg += "\n"
				} break;case 'align': {
					opts.msg += "\n"
					this.renderUtteranceBatch(elem, opts)
					opts.msg += "\n"
				} break;case 'table_cell': {
					this.renderUtteranceBatch(elem, opts)
					opts.msg += "; "
				} break;case 'divider': {
					opts.msg += "\n"
				} break;case 'table': {
					let headers = elem.content[0]
					headers = headers.content[0].args.header ? headers : false
					if (!headers) opts.msg += "\ntable\n"
					else {
						opts.msg += "\ntable with headers: "
						this.renderUtteranceBatch(headers, opts)
						opts.msg += "\n"
					}
				} break;default: {
					if (elem.content)
						this.renderUtteranceBatch(elem, opts)
					else {
						// store loaded copy of placeholderSound for replaying later
						this.placeholderSound = sound(this.placeholderSound).elem
						console.log(`TTS renderer ignored ${elem.type}`)
					}
				}
			}
		}
		
		// if we're root elem, we probably have unfinalized stuff.
		// finalize it and return the utterance list.
		if (tree.type == 'ROOT') {
			finalizeChunk()
			if (!opts.utter.length) {
				opts.msg += 'nothing'
				finalizeChunk()
			}
			return opts.utter
		}
	},
	
	// skip current utterance
	skip() {
		speechSynthesis.cancel()
		if (this.currentPart && this.currentPart.elem instanceof HTMLAudioElement)
			this.currentPart.elem.pause()
	},
	
	// skip a tagged batch that matches the provided tag
	skipTagged(tag) {
		if (this.currentBatch && this.currentBatch.tag == tag) this.skip();
		else this.queue = this.queue.filter(({t})=>tag!=t);
	},
	
	// replace one tagged batch with a lazily-evaluated batch.
	// returns whether newBatch was used or not
	replaceTagged(tag, newBatch) {
		if (this.currentBatch && this.currentBatch.tag == tag) {
			this.queue.unshift(newBatch());
			this.skip();
			
			return true;
		} else {
			let hits = 0;
			
			for (let [i, b] of this.queue.entries()) {
				if (b.tag != tag) continue;
				
				this.queue[i] = newBatch();
				hits++;
			}
			
			// if (!hits) this.speakUtteranceBatch(newBatch());
			
			return hits > 0;
		}
	},
	
	// cancel all utterances
	cancel() {
		this.queue = []
		this.skip()
	},
	
	skipKey: {
		_enabled: false,
		key: 'Control',
		
		enable(state = true) {
			if (this._enabled == state) return
			let toggle = `${state?'add':'remove'}EventListener`
			document[toggle]('keydown', this.keydown)
			document[toggle]('keyup', this.keyup)
			window[toggle]('blur', this.windowBlur)
			this._enabled = state
		},
		
		keydown(event) {
			let k = TTSSystem.skipKey
			if (event.key == k.key) {
				if (!k.action) {
					k.action = 'single'
				} else {
					k.action = 'double'
					k.callback && (k.callback = clearTimeout(k.callback))
				}
			} else {
				k.action = null
			}
		},
		keyup(event) {
			if (!document.hasFocus()) return;
			
			let k = TTSSystem.skipKey
			if (event.key == k.key) {
				if (k.action == 'single') {
					TTSSystem.skip()
					k.callback = setTimeout(()=>k.action = null, 300)
				} else if (k.action == 'double') {
					TTSSystem.cancel()
					k.action = null
				}
			}
		},
		
		windowBlur(_event) { TTSSystem.skipKey.action = null }
	}
}

;(()=>{
	Settings.add({
		name: 'tts_notify', label: "TTS Notify", type: 'select',
		options: ['no', 'quiet', 'everyone else', 'yes'],
	})
	Settings.add({
		name: 'tts_volume', label: "TTS Volume", type: 'range',
		range: [0.0, 1.0],
		default: 0.5,
		step: "0.05", //making this a string to /potentially/ bypass floating point
		notches: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], // 🥴
		update(value, type) {
			TTSSystem.userParams[0].volume = value
			if ('change'==type) {
				TTSSystem.cancel()
				if (TTSSystem.placeholderSound)
					TTSSystem.speakMessage({text:"{#uwu",values:{m:'12y'}}, true)
				else
					TTSSystem.speakMessage("example message")
			}
		}
	})
	Settings.add({
		name: 'tts_speed', label: "TTS Speed", type: 'range',
		range: [0.5, 5], // (heard range may be narrower)
		step: "0.05",
		default: 1,
		notches: [1],
		update(value, type) {
			TTSSystem.userParams[0].rate = value
			if ('change'==type) {
				TTSSystem.cancel()
				TTSSystem.speakMessage("example message")
			}
		},
	})
	Settings.add({
		name: 'tts_pitch', label: "TTS Pitch", type: 'range',
		range: [0, 2],
		step: "0.05",
		default: 1,
		notches: [1],
		update(value, type) {
			TTSSystem.userParams[0].pitch = value
			if ('change'==type) {
				TTSSystem.cancel()
				TTSSystem.speakMessage("example message")
			}
		},
	})
})()

Events.messages.listen(this, (c)=>{
	let notifyMode = Settings.values.tts_notify;
	if (notifyMode === 'no') return;
	
	if (c.length > 3) c = c.slice(-3);
	
	let currentRoom = View.current instanceof PageView ? View.current.page_id : NaN;
	
	for (let message of c) {
		// filter out your messages, if you asked to.
		let fromYou = message.createUserId == Req.uid;
		if (fromYou && notifyMode !== 'yes')
			continue;
		
		let roomSettings = TTSSystem.getRoomSettings(message.contentId);
		
		let isLocal = message.contentId == currentRoom;
		
		// if quiet mode enabled, just always use the global option
		// (and yes, quiet mode also filters out your messages)
		if (notifyMode === 'quiet')
			isLocal = false;
		
		let localNotNone = roomSettings.localAction !== 'none';
		let action = ((isLocal && localNotNone) ? roomSettings.localAction : roomSettings.globalAction) || 'none';
		
		if (action === 'none') {
			continue;
		} else if (action === 'speak') {
			if (message.deleted) {
				// pull message from queue (if still in there), to respect wishes.
				TTSSystem.skipTagged(message.id);
				continue;
			}
			
			let [ room, user, time ] = [
				message.contentId,
				message.createUserId,
				new Date(message.createDate)
			];
			
			// "merge" messages from the same user, removing the "user says" part of the utterance.
			let merge = TTSSystem.lastMessage.room == room
			&& TTSSystem.lastMessage.user == user
			&& Math.abs(time - TTSSystem.lastMessage.time) < 1000*60*3;
			
			// save this information to check against later.
			TTSSystem.lastMessage.room = room;
			TTSSystem.lastMessage.user = user;
			TTSSystem.lastMessage.time = time;
			
			if (message.edited) {
				let batch = ()=>TTSSystem.batchFromMessage(message, merge);
				if (!TTSSystem.replaceTagged(message.id, batch)) {
					// TODO: sound effects for unused replacement
				}
				continue;
			}
			
			TTSSystem.speakMessage(message, merge);
		} else {
			// sound effect
			
			// skip if it's actually a deletion oops
			if (message.deleted) continue;
			
			TTSSystem.notifySound(action);
		}
	}
})

do_when_ready(()=>{
	let userTabButtons = $sidebarUserPanel.querySelector('.registerBox');
	let injectButton = document.createElement('button');
	injectButton.onclick = ()=>TTSSystem.cancel();
	injectButton.onmouseover = ()=>{
		injectButton.title = `${TTSSystem.queue.length} messages in TTS queue`;
	};
	injectButton.textContent = "Stop TTS";
	userTabButtons.appendChild(injectButton);
	userTabButtons.appendChild($logOut);
})

/* ```

* Configuring the basics:

The script contributes a handful of settings, so just check the user tab of the 12 frontend.

It lists four options:
- 'no' -  you won't hear TTS or notification sounds.
- 'quiet' - the global action for rooms will override the local action. good for if you only want to hear notification sounds.
- 'everyone else' - normal behavior, but you won't hear your own messages.
- 'yes' - normal behavior, and you will hear your own messages.

* Configuring beyond the basics:

If you insert snippets that modify `TTSSystem` into your UserJS, you can configure the TTS more:

- Add a placeholder sound
  - simply assign a URL to `TTSSystem.placeholderSound`
  - plays when volume adjusted in user tab
  - plays whenever an unrecognized 12y tag is encountered
- Enable & configure the "skip key"
  - `TTSSystem.skipKey.enable(true)` - sets up the event handlers and such
  - `TTSSystem.skipKey.key` (by default is 'Control' - but can be any key)
  - press it once to skip a single utterance
  - press it twice (relatively) quickly to cancel all utterances
- Configure default voice
  - `TTSSystem.userParams[0]` contains global TTS parameters, such as volume - all the stuff that you configure inside the user tab.
  - `TTSSystem.userParams[0].voice = "Zira"` (i think this is a line of docs i forgot to finish writing?? lol?)
- Some bonus configuration options
  - `TTSSystem.rubyPronunciationOnly` will discard any children of ruby elements, only reading the pronunciation information. intended for foreign languages.
  - `TTSSystem.renderInsideSpoilers` will render inside spoilers as if they were quote blocks. use with care.
- Create per-user TTS synthesizer parameter profiles
  - two types of keys into `userParams`: (may change later)
    - qcs user id (number)
    - bridge name (string)
  - and a parameter object includes zero or more of these fields:
    - `nickname` - a string that specifies how the TTS speaks the username
    - `voice` - a string that matches (part of) a TTS voice
    - `volume` - a number in [0, 1]. how loud the voice is
    - `pitch` - a number in [0, 2]. the pitch of the voice
    - `rate` - a number in [0.1, 10]. how fast the voice speaks
    - `msg` - a string with the pre-message message (will override `nickname`'s effects)
	- `useNickname` - a boolean meant for qcs user configurations. defaults to false. if the TTS should use the currently-set nickname instead of the username.
- Change how text is pronounced with `replaceText`
  - uses syntax from `String.prototype.replaceAll` (strings, regexes, functions; all available)
  - `TTSSystem.replaceText(`{#sup{#sub pattern:}}`"V360",`{#sup{#sub replacement:}}`"v 3 60")`
  - if pattern is a string, it'll be converted into a regex. you don't have to think about escaping or anything, it's all good.
  - if pattern is a regex and it has no flags set (and the secret third "surround" flag isn't unset), it'll be surrounded with word boundaries and given flags and everything,
  - it's recommended to do `TTSSystem.clearReplacements()` at the start of your siteJS so replacements don't accumulate while you try out new ones
- Create per-room rules for the TTS system
  - by default, there's `TTSSystem.roomSettings[0] = { localAction: 'speak', globalAction: 'none' }`
  - as you can see, both `localAction` and `globalAction` are enums (and they also slightly aren't..) here's the options you can use:
    - `'speak'` - speak the message
    - `'none'` - do nothing with the message 
      - if this is used as the local action, I'll use the global action instead. this makes sense probably
    - `"`{/url to sound}`"` - play the sound when the message is received
  - your messages will be unconditionally skipped if you have "TTS Notify" set to `'everyone else'`. if this sucks, tell me and i can change it lo
  - sorry the official contentapi term is "pages", but uh.. i guess this is okay because it's chat focused, not content focused

** I want to apply one configuration to multiple keys!

```js
TTSSystem.userParams[123] = TTSSystem.userParams["bridge"] = { nickname: "bridge user" }
```

And if you ever want to get really wild, there's always `Object.assign`.

* Example UserJS:

```js
do_when_ready(()=>{
	TTSSystem.placeholderSound = "https://raw.githubusercontent.com/TheV360/qcs-tts/main/meow.wav"
	TTSSystem.skipKey.enable(true)
	
	TTSSystem.userParams[0].voice = "Zira" // global voice
	// string only has to match a little of the name
	
	// userParams accepts either a user id or a bridge name as its key,
	// and.. well there's the list of params demonstrated there:
	TTSSystem.userParams[123] = { nickname: "qcs user" }
	TTSSystem.userParams["bridge"] = {
		nickname: "bridge user",
		voice: "Zira",
		volume: 1,
		pitch: 1,
		rate: 3.60
	}
	
	// play a funny sound any time something happens
	let myFunnyNotifSound = "https://raw.githubusercontent.com/TheV360/qcs-tts/main/808cowbell.mp3"
	TTSSystem.roomSettings[0] = { localAction: 'speak', globalAction: myFunnyNotifSound }
	
	// room-specific stuff
	let quietRoom = 'put the room id here'
	let ignoreRoom = 'put the room id here'
	let touhouRoom = 'i dont understand touhou and at this point im too afraid to ask'
	TTSSystem.roomSettings[quietRoom] = { localAction: 'none' } // only plays notif sound even if active room
	TTSSystem.roomSettings[ignoreRoom] = { localAction: 'none', globalAction: 'none' } // ignores room
	TTSSystem.roomSettings[touhouRoom] = { globalAction: 'none' } // falls back to global setting if active room
	
	TTSSystem.clearReplacements()
	TTSSystem.replaceText("lol", "lawl")
	TTSSystem.replaceText("idk", "i dunno")
	TTSSystem.replaceText('nade', 'nah day')
	TTSSystem.replaceText(/a{2,}/, "$&h")
	TTSSystem.replaceText(/sona(s)?\b/gi, " so nuh$1")
})
```

```js
i love doing this. it's like shutting the door as you step outside..
*/// ```
