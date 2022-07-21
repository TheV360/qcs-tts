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
			
			let removeListeners = ()=>{ se.onpause = se.onerror = null }
			
			se.onpause = e=>removeListeners((se.currentTime < se.duration) ? nay(e) : yay())
			se.onerror = e=>removeListeners(nay(e))
			
			se.play()
		})
	},
	
	getMessageAuthorName(message) {
		if (message.Author && message.Author.bridge)
			return message.Author.nickname || message.values.b;
		else
			return message.Author.username;
	},
	
	getUserParam(message) {
		let k; if (message.Author && message.Author.bridge)
			k = message.Author.nickname || message.values.b
		else
			k = message.createUserId;
		return Object.assign({}, this.userParams[0], this.userParams[k]);
	},
	
	lastMessage: [
		// roomId,
		// userId,
		// time
	], // OR simply blank array when roomID changes, lol
	
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
		elem.loop = false;
		this.speakUtteranceBatch([{ elem, volume: this.userParams[0].volume }])
		return elem; // -> so you can cache stuff like placeholderSound
	},
	
	speakMessage(message, merged = false) {
		if ('object'!=typeof message) {
			message = { text: String(message), values: { m: 'plaintext' } };
			merged = true;
		}
		
		let tree = Markup.langs.parse(message.text, message.values.m);
		
		let opts = this.getUserParam(message);
		
		if (!merged) {
			opts.nickname || (opts.nickname = this.getMessageAuthorName(message));
			opts.msg || (opts.msg = `${opts.nickname} says; `);
		}
		
		this.speakUtteranceBatch(this.renderUtteranceBatch(tree, opts))
	},
	
	queue: [],
	currentBatch: null,
	currentPart: null,
	
	async speakUtteranceBatch(utter) {
		this.queue.push(utter)
		
		// it may already be speaking. if so, we've already done enough.
		if (this.queue.length > 1 || this.currentBatch) return;
		
		while (this.queue.length) {
			try {
				this.currentBatch = this.queue.shift()
				for (let u of this.currentBatch) {
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
	
	placeholderSound: null,
	
	userParams: {
		[0]: { // global params
			voice: null,
			volume: 1,
			pitch: 1,
			rate: 1.25,
		},
	},
	
	_textReplacements: [],
	replaceText(x, y) { this._textReplacements.push([x, y]) },
	
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
			u.elem.loop = false
			opts.utter.push(u)
			return u;
		}
		
		let renderWithAltParams = (elem, {volume = 1, pitch = 1, rate = 1})=>{
			let prev = [ opts.volume, opts.pitch, opts.rate ]
			opts.volume *= volume; opts.pitch *= pitch; opts.rate *= rate
			finalizeChunk()
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
					if (elem.args.lang && elem.args.lang != 'sb') // sign of the times...
						opts.msg += ` written in ${elem.args.lang}`
					opts.msg += "\n"
				} break;case 'icode': {
					opts.msg += elem.args.text
				} break;case 'spoiler': {
					opts.msg += "\nspoiler"
					if (elem.args.label)
						opts.msg += ` for ${elem.args.label}`
					opts.msg += "\n"
				} break;case 'heading': {
					renderWithAltParams(elem, { rate: 0.75, volume: 1.25 })
				} break;case 'subscript': case 'superscript': {
					renderWithAltParams(elem, { volume: 0.75 })
				} break;case 'quote': {
					opts.msg += "\nquote"
					if (elem.args.cite)
						opts.msg += ` from ${elem.args.cite}`
					opts.msg += "\n"
					this.renderUtteranceBatch(elem, opts)
					opts.msg += "\n(end quote)\n"
				} break;case 'ruby': {
					this.renderUtteranceBatch(elem, opts)
					if (elem.args.text)
						opts.msg += ` (${elem.args.text})`
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
			if (!state) {
				document.removeEventListener('keydown', this.keydown)
				document.removeEventListener('keyup', this.keyup)
			} else {
				document.addEventListener('keydown', this.keydown)
				document.addEventListener('keyup', this.keyup)
			}
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
		}
	}
}

Settings.add({
	name: 'tts_notify', label: "TTS Notify", type: 'select',
	options: ['no', 'everyone else', 'yes'],
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

Events.messages.listen(this, (c)=>{
	if (Settings.values.tts_notify == 'no') return
	
	if (c.length > 3) {
		c = c.slice(-3)
		
		// i'm hilarious.
		TTSSystem.speakMessage({text:"!https://raw.githubusercontent.com/TheV360/qcs-tts/main/explode.mp3",values:{m:'12y'}}, true)
	}
	
	let pid = View.current instanceof PageView ? View.current.page_id : NaN
	
	for (let msg of c) {
		// filter out
		if (msg.createUserId ==Req.uid && Settings.values.tts_notify!='yes')
			continue
		if (!Entity.is_new_comment(msg))
			continue
		
		if (msg.contentId==pid) {
			// current room
			TTSSystem.speakMessage(msg)
		} else {
			// another room
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
  - `TTSSystem.userParams[0].voice = "Zira" `
- Create per-user TTS synthesizer parameter profiles
  - two types of keys into `userParams`: (may change later)
    - qcs user id (number)
    - bridge name (string)
  - and a parameter object includes these fields:
    - `nickname` - a string that specifies how the TTS speaks the username
    - `voice` - a string that matches (part of) a TTS voice
    - `volume` - a number in [0, 1]. how loud the voice is
    - `pitch` - a number in [0, 2]. the pitch of the voice
    - `rate` - a number in [0.1, 10]. how fast the voice speaks
    - `msg` - a string with the pre-message message (will override `nickname`'s effects)
- Change how text is pronounced with `replaceText`
  - uses syntax from `String.prototype.replaceAll` (strings, regexes, functions; all available)
  - `TTSSystem.replaceText("V360", "v 3 60")`

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
})
```

* cool ideas for the future

- list of words to replace with either alternate pronunciations or sounds
  - don't pronounce "nade nade" like grenade.
  - meme potential.

```js
hi
*/// ```
