- simple interface with `speakString` and `speakSound`
	- what parts of this should i pull out?
		- `speakSound` returns elem that it (may have) loaded, caching is easy
	- could always create a class like `TTSQueueItem` and ..
		- getters and setters that properly fetch stuff like tts voices and cached audio files
		- match on a `type` field instead of lazy instanceof stuff
		- fun fact: setters work with `Object.assign`... just sayin'..  
			```js
			Object.assign({ set a(val) { alert(val) } }, {a: 5});
			```
- room notifications
	- becomes riskier when multiple tabs open. i heard that uh.. a single websocket drives multiple tabs? could only trigger this on the "main tab"?
		- nope! only cherry did this.. as long as there's only one tab, lol..
		- entire [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) just for keeping track of pages.. 😏
	- for now i donâ€™t FREAKING care

mysteries
----
- did that "skip key" fix thing actually work?

done
----
- ~~pronunciation replaceAll~~
	- ~~done:   replace simple things~~
	- funny but not needed: replace words with sfx
- ~~deleted / edited behavior~~
	- ~~cancel them, start edited post from start. requires change in architecture - consider finally moving renderer out into a thing that produces a speech script thing? and speech script must be tagged with postID to find it and cancel it / modify it~~
- ~~merge messages~~
	- ~~save roomID, userID, time; compare them to recent message~~
	- ~~hell just save last message like a normal person~~
