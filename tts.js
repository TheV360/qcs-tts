'use strict'

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
	
	getUserParam(message) {
		if (message.Author && message.Author.bridge)
			return this.userParams[message.Author.nickname || message.values.b]
		else
			return this.userParams[message.createUserId]
	},
	
	speakMessage(message, merged = false) {
		let tree = Markup.langs.parse(message.text, message.values.m)
		
		let opts = { ...this.getUserParam(message), msg: "" }
		
		if (!merged) {
			if (!opts.nickname) {
				if (message.Author && message.Author.bridge)
					opts.nickname = message.Author.nickname || message.values.b
				else
					opts.nickname = message.Author.username
			}
			opts.msg = `${opts.nickname} says\n`
		}
		
		this.speakScript(this.renderSpeechScript(tree, opts))
	},
	
	queue: [],
	currentScript: null,
	currentPart: null,
	async speakScript(utter) {
		this.queue.push(utter)
		if (this.queue.length > 1 || this.currentScript)
			return
		
		while (this.queue.length) {
			try {
				this.currentScript = this.queue.shift()
				for (let u of this.currentScript) {
					this.currentPart = u
					if (u instanceof SpeechSynthesisUtterance) await this.speakUtterance(u)
					else if (u.elem instanceof HTMLAudioElement) await this.playSound(u)
				}
			} catch {} finally {
				this.currentScript = null
				this.currentPart = null
			}
		}
	},
	
	placeholderSound: null,
	
	synthParams: {
		voice: null,
		volume: 1,
		pitch: 1,
		rate: 1.25,
	},
	
	userParams: {
		// [userId || bridge name]: { any fields of synthParams you want to override }
	},
	
	voiceFrom(name) {
		return speechSynthesis.getVoices().find(v=>v.name.includes(name))
	},
	
	// creates a list of smaller utterances and media to play in sequence
	renderSpeechScript(tree, opts = {}) {
		opts.msg || (opts.msg = "")
		
		if ('string'==typeof opts.voice)
			opts.voice = this.voiceFrom(opts.voice)
		
		opts.volume || (opts.volume = this.synthParams.volume)
		opts.pitch || (opts.pitch = this.synthParams.pitch)
		opts.rate || (opts.rate = this.synthParams.rate)
		
		opts.utter || (opts.utter = [])
		opts.media || (opts.media = {})
		
		let sound = url=>{
			if (!url)
				return
			finalizeChunk()
			let u = { volume: Math.max(0, Math.min(opts.volume, 1)) }
			if (url instanceof HTMLAudioElement)
				u.elem = url
			else
				u.elem = opts.media[url] || (opts.media[url] = new Audio(url))
			u.elem.loop = false
			opts.utter.push(u)
			return u
		}
		
		let renderWithAltParams = (elem, {volume = 1, pitch = 1, rate = 1})=>{
			let prev = [ opts.volume, opts.pitch, opts.rate ]
			opts.volume *= volume; opts.pitch *= pitch; opts.rate *= rate
			finalizeChunk()
			this.renderSpeechScript(elem, opts)
			finalizeChunk()
			;[ opts.volume, opts.pitch, opts.rate ] = prev
		}
		
		// pushes utterance onto the end of the speech queue.
		let finalizeChunk = ()=>{
			opts.msg = opts.msg.trim()
			if (!opts.msg.length)
				return
			
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
			if (s.includes("://qcs.s")) return "qcs"
			if (s.includes("cdn.discordapp.com/")) return "discord"
			if (s.includes(" ") && !s.includes(".")) return false // silly fake link heuristics
			if (s.includes(" ") && s.includes(".") && s.indexOf(" ") < s.indexOf(".")) return false
			if (s.startsWith('#')) return `anchor "${s.substring(1)}"`
			else try { return new URL(s).hostname.replace("www.", "") }
			catch { return "invalid URL" }
		}
		
		for (let elem of tree.content) {
			if ('string'==typeof elem) {
				if (elem.length > 2500)
					opts.msg += "(message too long)"
				else
					opts.msg += elem
			} else switch (elem.type) {
				case 'italic': {
					this.renderSpeechScript(elem, opts)
					// renderWithAltParams(elem, { rate: 0.75 })
				} break;case 'bold': {
					this.renderSpeechScript(elem, opts)
					// renderWithAltParams(elem, { pitch: 0.75 })
				} break;case 'strikethrough': {
					renderWithAltParams(elem, { rate: 1.25, volume: 0.75 })
				} break;case 'underline': {
					this.renderSpeechScript(elem, opts)
					// renderWithAltParams(elem, { pitch: 0.75, rate: 0.75 })
				} break;case 'video': {
					opts.msg += `\nvideo from ${simplifyUrl(elem.args.url)}\n`
				} break;case 'youtube': {
					opts.msg += "\nyoutube video\n"
				} break;case 'link': {
					// depending on if they're labeled or unlabeled,
					// i treat these as either inline or block respectively.
					// inline being normal space pause, block being sentence break.
					if (elem.content) {
						this.renderSpeechScript(elem, opts)
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
					this.renderSpeechScript(elem, opts)
					opts.msg += "\n(end quote)\n"
				} break;case 'ruby': {
					this.renderSpeechScript(elem, opts)
					if (elem.args.text)
						opts.msg += ` (${elem.args.text})`
				} break;case 'bg':case 'key':case 'list':case 'anchor': {
					this.renderSpeechScript(elem, opts)
				} break;case 'list_item': {
					this.renderSpeechScript(elem, opts)
					opts.msg += "\n"
				} break;case 'align': {
					opts.msg += "\n"
					this.renderSpeechScript(elem, opts)
					opts.msg += "\n"
				} break;case 'table_cell': {
					this.renderSpeechScript(elem, opts)
					opts.msg += "; "
				} break;case 'divider': {
					opts.msg += "\n"
				} break;case 'table': {
					let headers = elem.content[0]
					headers = headers.content[0].args.header ? headers : false
					if (!headers) opts.msg += "\ntable\n"
					else {
						opts.msg += "\ntable with headers: "
						this.renderSpeechScript(headers, opts)
						opts.msg += "\n"
					}
				} break;default: {
					if (elem.content)
						this.renderSpeechScript(elem, opts)
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
		TTSSystem.synthParams.volume = value
		if ('change'==type) {
			TTSSystem.cancel()
			if (TTSSystem.placeholderSound)
				TTSSystem.speakMessage({text:"{#uwu",values:{m:'12y'}}, true)
			else
				TTSSystem.speakMessage({text:"example message",values:{m:'plaintext'}}, true)
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
		TTSSystem.synthParams.rate = value
		if ('change'==type) {
			TTSSystem.cancel()
			TTSSystem.speakMessage({text:"example message",values:{m:'plaintext'}}, true)
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
		TTSSystem.synthParams.pitch = value
		if ('change'==type) {
			TTSSystem.cancel()
			TTSSystem.speakMessage({text:"example message",values:{m:'plaintext'}}, true)
		}
	},
})

Events.messages.listen(this, (e)=>{
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
		this.title = `${TTSSystem.queue.length} messages in TTS queue`;
	};
	injectButton.textContent = "Stop TTS";
	userTabButtons.appendChild(injectButton);
	userTabButtons.appendChild($logOut);
})

// do_when_ready(()=>{
// TTSSystem.placeholderSound = "https://raw.githubusercontent.com/TheV360/qcs-tts/main/meow.wav"
// TTSSystem.skipKey.enable(true)
// 
// TTSSystem.userParams[123] = { nickname: 'v 3 60' }
// TTSSystem.userParams["V360"] = { rate: 3.60, nickname: 'v 3 60' }
// })
