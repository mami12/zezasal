/*******************************************************************************
ALEKSANDAR ACHEV (PIXI)
pixi-legacy.js - v6.5.10
COMENT:
	1) <animObj_PIXI> class was added to project;
	2) <createCtgPixi> function was added to project;
	3) <CTG_PIXI> (instance of <PIXI.Application> class) was added to project;
	4) <maskOfCTG_PIXI__Class> class was added to project;
	5) <innerMaskOfCTG_PIXI> (instance of <maskOfCTG_PIXI__Class> class) was added to project;
	6) <createTreeWithDiamondsPixi> function was added to project;
	7) <TREE_WITH_DIAMONDS_PIXI> (instance of <PIXI.Application> class) was added to project;
	8) <removeAllStageContent> function was added to project;
	9) <animation_PIXI> class was added to project;
	10) <spineAnim> class was added to project;

--- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
	animObject (описание на полета произлезли от <animData>):

	.load - bool - ако го има, анимацията се зарежда, във противен случай не се зарежда.
	.skeleton - string - името на файла(.json) със описанието на анимацията-арматурата-"спраита",
	.texture_json - string - името на файла(.json) със описанието на текстурата,
	.texture_png - string - името на файла(.png) със съдържанието на текстурата,
	.armature - string - името на арматурата (пише го във .skeleton файла),
	.project - string - името на "проекта на анимацията" (пише го във .skeleton файла),
	.animation - string - името на анимацията (пише го във .skeleton файла),

  .isSpine - bool - ако го има, значи анимацията ще се третира от кода като "spine" анимация,
	.filePath - string - името на файла(.json) със описанието на анимацията, !важи само за "spine" анимации!
	.defaultAnim - string - името на анимацията по подразбиране, !важи само за "spine" анимации!
	.loopAnim - string - името на анимацията за цикъл, !важи само за "spine" анимации!

	.autoRemove - bool - ако го има, анимацията се премахва автоматично след неиният край (след "endAnim" се извиква "removeAnim"),
	.loopCount - int - колко пъти трябва да бъде възпроизведена анимацията, !не важи за "spine" анимации!
	.attractionBackground - bool - ако го има, анимацията се "плеива" на фона на "background_online_1920_attract", !не важи за "spine" анимации!
	.nonstopAttraction - bool - ако го има, анимацията не може да се спре от потребителя,
	.slowShowing - bool - ако го има, анимацията започва със плавно нарастване на "alpha"-та("opacity"-то),
	.fading - bool - ако го има, анимацията завършва със плавно намаляване на "alpha"-та("opacity"-то),
	.sound - false OR string - ако го има, посоченият звук се възпроизвежда,
	.soundFading - bool - ако го има, <.sound>(ако го има) затихва бавно при край на анимацията,
	.stopAnimOnSoundEnd - bool - ако го има, анимацията се прекратява принудително при край на <.sound>(ако го има),
	.maxAnimTime - false OR int - ако го има, анимацията се прекратява принудително при изтичане на посоченото време (във ms);
*******************************************************************************/
console.log("<<<<<<<<<< CT Gaming - PIXI library - ver 4.32 15.10.2025 >>>>>>>>>>");

const CTG_PIXI = createCtgPixi("attraction_view");
const TREE_WITH_DIAMONDS_PIXI = gameConfig.diamond_bonus_enabled ? createTreeWithDiamondsPixi("TREE_WITH_DIAMONDS_PIXI") : null;
const innerMaskOfCTG_PIXI = new maskOfCTG_PIXI__Class();

function animObj_PIXI(PIXI_HandleArg, skeletonArg, texture_jsonArg, texture_pngArg, armatureNameArg, projectNameArg, animatioNameArg) {
//---variables initialization---------------------------------------------------
	let PIXI_Handle = PIXI_HandleArg;
	this.skeleton = skeletonArg;
	this.texture_json = texture_jsonArg;
	this.texture_png = texture_pngArg;
	this.armature = armatureNameArg;
	this.project = projectNameArg;
	this.animation = animatioNameArg;
	this.animationNames = null;
	this.armatureNames = null;
	let factory = dragonBones.PixiFactory.factory;
	let armatureDisplay = null;
	let parentContainer = null; //<this.PIXI_Handle.stage> OR some other <PIXI.Container>
	let rectangle = null;
//---functions declaration------------------------------------------------------
	this.loadInMemory = loadInMemory;
	this.loadIn_PixiFactory = loadIn_PixiFactory;
	this.loadArmature = loadArmature;
	this.addToStage = addToStage;
	this.removeArmatureDisplay = removeArmatureDisplay;
	this.setAnimPos = setAnimPos;
	this.getPIXI_Handle = getPIXI_Handle;
	this.getArmatureDisplay = getArmatureDisplay;
	this.getParentContainer = getParentContainer;	//***
	this.getRectangle = getRectangle;	//***
	this.playAnim = playAnim;
	this.playAnimFromFrame = playAnimFromFrame; //***
	this.stopAnim = stopAnim;
	this.hasAnim = hasAnim;
	this.isCompleted = isCompleted; //***
	this.missingArmatureDisplayError = missingArmatureDisplayError;
	this.missingParentContainerError = missingParentContainerError;
	this.parentContainerAlreadyExistError = parentContainerAlreadyExistError;
	this.missingAnimationNamesError = missingAnimationNamesError;
	this.createRectangle = createRectangle; //***
	this.removeRectangle = removeRectangle; //***
	this.setAnimEvent_onTime = setAnimEvent_onTime; //***
//---functions definition-------------------------------------------------------
	function loadInMemory() {
		PIXI.Loader.shared.add(this.skeleton);
		PIXI.Loader.shared.add(this.texture_json);
		PIXI.Loader.shared.add(this.texture_png);
	}
	function loadIn_PixiFactory() {
		this.armatureNames=[];
		PIXI.Loader.shared.resources[this.skeleton].data
			.armature.forEach((armature)=>{this.armatureNames.push(armature.name)});
		this.animationNames=[];
		PIXI.Loader.shared.resources[this.skeleton].data
			.armature.find((armature)=>{return armature.name===this.armature})
			.animation.forEach((anim)=>{this.animationNames.push(anim.name)});

		factory.parseDragonBonesData(PIXI.Loader.shared.resources[this.skeleton].data);
		factory.parseTextureAtlasData(PIXI.Loader.shared.resources[this.texture_json].data, PIXI.Loader.shared.resources[this.texture_png].texture);
	}
	function loadArmature(armatureName, projName) {
		if(armatureName && projName){
			armatureDisplay = factory.buildArmatureDisplay(armatureName, projName);
		}
		else {
			if(this.armature && this.project) {
				this.loadArmature(this.armature, this.project)
			}
			else {
				console.log('CTG_PIXI Error! MSG:<this.armature>===null OR <this.project>===null');
				console.log('this = ', this);
			}
		}
	}

	function addToStage(containerArgument) { //Add to some <PIXI.Container> OR direct to <Stage>
		if(this.missingArmatureDisplayError()) return;
		if(this.parentContainerAlreadyExistError()) return;
		const container = containerArgument||PIXI_Handle.stage;
		container.addChild(armatureDisplay);
		parentContainer = container;
	}
	function removeArmatureDisplay() {
		if(this.missingParentContainerError()) return;
		armatureDisplay.animation.stop();
		parentContainer.removeChild(armatureDisplay);
		this.removeRectangle();
		parentContainer = null;
	}
	function setAnimPos(x/*anim center*/, y/*anim center*/) {
		if(this.missingParentContainerError()) return;
		armatureDisplay.x = x/**(1/app.renderer.resolution)*/;
		armatureDisplay.y = y/**(1/app.renderer.resolution)*/;

		//armatureDisplay.scale.set(window.innerWidth/standartWidth, window.innerHeigh/standartHeight);
		//armatureDisplay.scale.set(PIXI_Handle.render.width/standartWidth, PIXI_Handle.render.heigh/standartHeight);
	}

//region@getters---begin--------------------------------------------------------
	function getPIXI_Handle() {return PIXI_Handle;}
	function getArmatureDisplay() {return armatureDisplay;}
	function getParentContainer() {return parentContainer;}
	function getRectangle() {return rectangle;}
//region@getters---end----------------------------------------------------------

//region@animation---begin------------------------------------------------------
	function playAnim(animName, iterationsCount, startTime/*inSeconds*/, endTime/*inSeconds*/) {
		if(this.missingParentContainerError()) return;
		if(animName) {
			let animDuration = armatureDisplay.animation.animations[animName].duration;
			if(endTime) armatureDisplay.animation.animations[animName].duration = endTime;
			if(startTime) armatureDisplay.animation.gotoAndPlayByTime(animName, startTime, iterationsCount||1);
			else armatureDisplay.animation.play(animName, iterationsCount||1);
			armatureDisplay.animation.animations[animName].duration = animDuration;
		}
		else {
			if(this.animation) {
				this.playAnim(this.animation, iterationsCount, startTime, endTime);
			}
			else {
				console.log('CTG_PIXI Error! MSG:<this.animation>===null');
				console.log('this = ', this);
			}
		}
	}
	function playAnimFromFrame(animName, iterationsCount, startFrame) {
		if(this.missingParentContainerError()) return;
		armatureDisplay.animation.gotoAndPlayByFrame(animName, startFrame, iterationsCount||1);
	}
	function stopAnim(animName, frame) {
		if(this.missingParentContainerError()) return;
		if(frame)
			armatureDisplay.animation.gotoAndStopByFrame(animName, frame);
		else
			armatureDisplay.animation.stop(animName);
	}
	/*
	function hasAnim(animName) {
		if(this.missingParentContainerError()) return false;
		return armatureDisplay.animation.hasAnimation(animName);
	}
	*/
	function hasAnim(animName) {
		if(this.missingAnimationNamesError()) return false;
		return this.animationNames.includes(animName);
	}
	function isCompleted() {
		if(this.missingParentContainerError()) return false;
		return armatureDisplay.animation.isCompleted;
	}
//region@animation---end--------------------------------------------------------

//region@errorsHandling---begin-------------------------------------------------
	function missingArmatureDisplayError() {
		if(armatureDisplay===null) {
			console.log('CTG_PIXI Error! MSG:<armatureDisplay> must be loaded before usage!\nMay be you should use <loadArmature>function!');
			console.log('this = ', this);
			return true;
		}
		else
			return false;
	}
	function missingParentContainerError() {
		if(parentContainer===null) {
			console.log('CTG_PIXI Error! MSG:<parentContainer> must be set before further actions!\nMay be you should use <addToStage>function!');
			console.log('this = ', this);
			return true;
		}
		else
			return false;
	}
	function parentContainerAlreadyExistError() {
		if(parentContainer) {
			console.log('CTG_PIXI Error! MSG:<parentContainer> already exist!\nYou CAN\'T use <addToStage>function for this object anymore!');
			console.log('this = ', this);
			return true;
		}
		else
			return false;
	}
	function missingAnimationNamesError() {
		if (this.animationNames===null) {
			console.log('CTG_PIXI Error! MSG:<animationNames> is missing!\nMay be data for animations is still loading!');
			console.log('this = ', this);
			return true;
		}
		else
			return false
	}
//region@errorsHandling---end---------------------------------------------------

//region@rectangle---begin-----------------------------------------------------------
	function createRectangle() {
		if(this.missingParentContainerError()) return;
		const rect = new PIXI.Graphics();
		drawRectangle(rect);
		parentContainer.addChild(rect);
		rectangle = rect;
		PIXI_Handle.ticker.add(redrawRectangle);
		return rect;

		function redrawRectangle() {
			if(!rectangle)
				PIXI_Handle.ticker.remove(redrawRectangle);
			else {
				rectangle.clear();
				drawRectangle(rectangle);
			}
		}
		function drawRectangle(rect) {
			rect.lineStyle(10, 0xFFFF00, 1);
			rect.drawRect(
				armatureDisplay.getBounds().x,
				armatureDisplay.getBounds().y,
				armatureDisplay.getBounds().width,
				armatureDisplay.getBounds().height
			);
		}
	}
	function removeRectangle() {
		if(this.missingParentContainerError()) return;
		if(rectangle != null) {
			parentContainer.removeChild(rectangle);
			rectangle = null;
		}
	}
//region@rect---end-------------------------------------------------------------

	function setAnimEvent_onTime(userFunction) {
		PIXI_Handle.ticker.add(delta => userFunction(delta));
	}
};

function createCtgPixi(id) {
	const GL='#gameLayer', GC="#gameContainer"; //{second2}
	const standartWidth_PIXI = 1024; /*1400;*/ /*1920;*/
	const standartHeight_PIXI = 768; /*768;*/ /*1080;*/
	let result = new PIXI.Application({
	    width: standartWidth_PIXI,   // default: 800
	    height: standartHeight_PIXI, // default: 600
	    antialias: true,					// default: false
	    //transparent: true,      // default: false
			backgroundAlpha: 0.0,			// default:	1
	    resolution: 1.0						// default: PIXI.settings.RESOLUTION
			//sharedLoader: true			// default: false
	  }
	);
	result.renderer.view.id = id;
	result.stage.sortableChildren = true;

	//document.body.appendChild(result.view);
	//document.querySelector(GC).appendChild(result.view);
	document.querySelector(GL).appendChild(result.view);

	return result;
}

function createTreeWithDiamondsPixi(id) {
	let result = new PIXI.Application({
			width: 1060,/*1920,*/   // default: 800
			height: 596,/*1080,*/ // default: 600
			antialias: true,        // default: false
			//transparent: true,      // default: false
			backgroundAlpha: 0.0,
			resolution: 1.0
		}
	);
	result.renderer.view.id = id;
	document.querySelector("#tree_with_diamonds_frame").appendChild(result.view);
	return result;
}

function maskOfCTG_PIXI__Class() {
	var mask = null;
	this.setNewMask = function(x, y, width, height) {
		if(mask) this.removeOldMask();
		mask = new PIXI.Graphics();
		mask.beginFill(0xFFFFFF);
		mask.drawRect(x, y, width, height);
		CTG_PIXI.stage.addChild(mask); // make sure mask is added to display list somewhere!
		CTG_PIXI.stage.mask = mask;
	}
	this.getMaskBounds = function() {
		return mask.getBounds();
	}
	this.getMaskCenter = function() {
		let bounds = this.getMaskBounds();
		return {"x":bounds.x+bounds.width/2, "y":bounds.y+bounds.height/2};
	}
	this.removeOldMask = function() {
		CTG_PIXI.stage.mask = null;
		CTG_PIXI.stage.removeChild(mask);
		mask = null;
	}
}

var animList=[];
function animation_PIXI(animObject, call, x, y, startAnimCallback/*optional*/, parentContainer, szAnimListNameArg) {
	let thisObj = this;
	let active_animObject_PIXI = Object.assign(new animObj_PIXI(animObject.getPIXI_Handle()), JSON.parse(JSON.stringify(animObject)));
	let callback = call||(()=>{});
	let X = x||active_animObject_PIXI.getPIXI_Handle().renderer.width/2,
		Y = y||active_animObject_PIXI.getPIXI_Handle().renderer.height/2;
	let audioChannel = null;
	let endTimer = null;
	let playLoopAnimCallback = null;
	let isEnded = false;
	addToAnimList();
	this.startAnim = startAnim;
	this.endAnim = endAnim;
	this.removeAnim = removeAnim;
	this.fadeAudioChannel = fadeAudioChannel;
	this.stopAudioChannel = stopAudioChannel;
	this.replayAnim = replayAnim;
	this.getAnimSpeed = getAnimSpeed;
	this.setAnimSpeed = setAnimSpeed;
	this.replaceAnimCompleteHandler = replaceAnimCompleteHandler;
	this.stopAnim = stopAnim; //visualy stop animation;
	this.getAnimObject = function(){return active_animObject_PIXI};
	this.animArmature = null;
	this.isEnded = getEndedState;
	this.breakAnim = breakAnim; //completely stop and remove animation;

	function startAnim(animName, iterationsCount, startTime, endTime) {
		//Check for valid <animName> >>>
		if(animName && !active_animObject_PIXI.hasAnim(animName)) {
			if(active_animObject_PIXI.missingAnimationNamesError()) {
				setTimeout(()=>{startAnim(animName, iterationsCount, startTime, endTime)}, 1000);
			}
			else {
				console.log("CTG_PIXI Error! MSG:Invalid <animName> at <startAnim> at <animation_PIXI>");
				console.log('animName = ', animName);
				console.log('animationNames = ', active_animObject_PIXI.animationNames);
				console.log('this = ', this);
				removeFromAnimList();
				callback();
			}
			return;
		}

		//Display PIXI renderer >>>
		if(active_animObject_PIXI.getPIXI_Handle()===CTG_PIXI)
			CTG_PIXI.renderer.view.style.display = "block";

		//Check for properly loaded armature >>>
		if(thisObj.animArmature) active_animObject_PIXI.loadArmature(thisObj.animArmature, active_animObject_PIXI.project);
		else active_animObject_PIXI.loadArmature();
		if(active_animObject_PIXI.missingArmatureDisplayError()) {
			setTimeout(()=>{startAnim(animName, iterationsCount, startTime, endTime)}, 1000);
			return;
		}

		//Perform actions to play animation... >>>
		for(let property in active_animObject_PIXI[animName])
			active_animObject_PIXI[property] = active_animObject_PIXI[animName][property];
		const start = active_animObject_PIXI.start, loop = active_animObject_PIXI.loop,
    	frameRate = active_animObject_PIXI.getArmatureDisplay().armature.armatureData.frameRate,
			speedCoef = active_animObject_PIXI.speedCoef;
		iterationsCount = iterationsCount || active_animObject_PIXI.loopCount || 1;
		if(start) {
			startTime = frameToTimeMoment(start[0], frameRate);
			endTime = frameToTimeMoment(start[1], frameRate);
		}
		if(loop) {
			playLoopAnimCallback = ()=>{
				replayAnim(animName, 1, frameToTimeMoment(loop[0], frameRate), frameToTimeMoment(loop[1], frameRate));
			};
		}
		if(speedCoef) setAnimSpeed(speedCoef);
		active_animObject_PIXI.addToStage(parentContainer);
		active_animObject_PIXI.setAnimPos(X, Y);
		active_animObject_PIXI.playAnim(animName, iterationsCount, startTime, endTime);
		active_animObject_PIXI.getArmatureDisplay().addListener(dragonBones.EventObject.COMPLETE, endAnim);

		if(active_animObject_PIXI.slowShowing) {
			active_animObject_PIXI.getArmatureDisplay().alpha = 0.0;
			let intervalVar = setInterval(function() {
				if(active_animObject_PIXI.getArmatureDisplay().alpha >= 1.0) {
					active_animObject_PIXI.getArmatureDisplay().alpha = 1.0;
					clearInterval(intervalVar);
					intervalVar = null;
				}
				else {
					active_animObject_PIXI.getArmatureDisplay().alpha += 0.1;
				}
			},40);
		}

		if(window.self.soundOn && active_animObject_PIXI.sound) {
			audioChannel = createjs.Sound.play(active_animObject_PIXI.sound);
			if(active_animObject_PIXI.stopAnimOnSoundEnd)
				audioChannel.addEventListener('complete', endAnim);
		}
		if(active_animObject_PIXI.maxAnimTime)
			endTimer = setTimeout(endAnim, active_animObject_PIXI.maxAnimTime);

		if(!active_animObject_PIXI.nonstopAttraction) {
			$(document).on("keyup", _onKeyup);
			$(st).on(ck, endAnim);
		}
		if(startAnimCallback) startAnimCallback();
	}

	function endAnim() {
		isEnded = true;
		active_animObject_PIXI.getArmatureDisplay().removeListener(dragonBones.EventObject.COMPLETE, endAnim);
		if(active_animObject_PIXI.autoRemove) removeAnim();

		if(audioChannel) {
			if(active_animObject_PIXI.soundFading)
				fadeAudioChannel();
			else
				stopAudioChannel();
			if(active_animObject_PIXI.stopAnimOnSoundEnd)
				audioChannel.removeAllEventListeners();
		}
		if(active_animObject_PIXI.maxAnimTime)	clearTimeout(endTimer);

		if(!active_animObject_PIXI.nonstopAttraction) {
			$(document).off("keyup", _onKeyup);
			$(st).off(ck, endAnim);
		}
		callback();

		if(playLoopAnimCallback) {
			playLoopAnimCallback();
			replaceAnimCompleteHandler(playLoopAnimCallback);
		}
	}

	function removeAnim() {
		if(active_animObject_PIXI.fading) {
			let intervalVar = setInterval(function() {
				if(active_animObject_PIXI.getArmatureDisplay().alpha <= 0.0) {
					active_animObject_PIXI.getArmatureDisplay().alpha = 1.0;
					fadingEnd();
					clearInterval(intervalVar);
					intervalVar = null;
				}
				else
					active_animObject_PIXI.getArmatureDisplay().alpha -= 0.1;
			},100);
		}
		else {
			fadingEnd();
		}

		function fadingEnd() {
			active_animObject_PIXI.getArmatureDisplay().removeListener(dragonBones.EventObject.COMPLETE);
			active_animObject_PIXI.removeArmatureDisplay();
			removeFromAnimList();
			if(!animList.length && active_animObject_PIXI.getPIXI_Handle()===CTG_PIXI)
			  CTG_PIXI.renderer.view.style.display = "none";
		}
	}

	function fadeAudioChannel() {
		_fadeAudioChannel(audioChannel);
	}
	function stopAudioChannel() {
		_stopAudioChannel(audioChannel);
	}

	function replayAnim(animName, iterationsCount, startTime, endTime) {
		active_animObject_PIXI.playAnim(animName, iterationsCount, startTime, endTime);
	}
	function getAnimSpeed() {
		return active_animObject_PIXI.getArmatureDisplay().animation.timeScale;
	}
	function setAnimSpeed(speed) {
		active_animObject_PIXI.getArmatureDisplay().animation.timeScale = speed;
	}
	function replaceAnimCompleteHandler(newCallback) {
		active_animObject_PIXI.getArmatureDisplay().removeListener(dragonBones.EventObject.COMPLETE);
		active_animObject_PIXI.getArmatureDisplay().addListener(dragonBones.EventObject.COMPLETE, newCallback);
	}
	function stopAnim(animName, frame) {
		active_animObject_PIXI.stopAnim(animName, frame);
	}
	function addToAnimList() {
		if(active_animObject_PIXI.getPIXI_Handle()===CTG_PIXI)
		  _addToAnimList(thisObj);
		if(szAnimListNameArg)
		  _addToAnimList(thisObj, szAnimListNameArg);
	}
	function removeFromAnimList() {
		_removeFromAnimList(thisObj);
		if(szAnimListNameArg)
			_removeFromAnimList(thisObj, szAnimListNameArg);
	}
	function frameToTimeMoment(frame, frameRate) {//result is in seconds
		return frame/frameRate;
	}
	function timeMomentToFrame(time/*in seconds*/ , frameRate) {
		return frameRate*time;
	}

	function getEndedState() {
		return isEnded;
	}
	function breakAnim() {
		if(!isEnded) endAnim();
		if(!animData.autoRemove) removeAnim();
	}
}

function _onKeyup(e) {
	var code = e.keyCode || e.which;
	switch(e.keyCode || e.which) {
		case 32/*SPACEBAR key*/:
		case 13/*ENTER key*/:
			$("#buttonStart").click();
			break;
	}
}
function _addToAnimList(obj, szAnimListNameArg) {
	let szAnimListName = szAnimListNameArg||'animList';
	let currAnimList = szAnimListNameArg ? eval(szAnimListName) : animList;
	obj[`${szAnimListName}Index`] = currAnimList.push(obj)-1;
}
function _removeFromAnimList(obj, szAnimListNameArg) {
	let szAnimListName = szAnimListNameArg||'animList';
	let currAnimList = szAnimListNameArg ? eval(szAnimListName) : animList;
	delete currAnimList[obj[`${szAnimListName}Index`]];
	while(!currAnimList[currAnimList.length-1] && currAnimList.length>0)
	  currAnimList.length--;
}
function _fadeAudioChannel(audioChannel) {
	if(audioChannel.volume > .05){
		audioChannel.volume -=.05;
		setTimeout(function(){_fadeAudioChannel(audioChannel);},150);
	}else audioChannel.stop();
}
function _stopAudioChannel(audioChannel) {
	audioChannel.stop();
}
//animation_PIXI.getAnimList = function() {return animList;};
//animation_PIXI.clearAnimList = function() {animList = [];};
animation_PIXI.performSomeActionToAll = function(animListArg, action) {
	let currAnimList = animListArg||animList;
	for(let i = 0; i < currAnimList.length; i++)
		if(currAnimList[i]) {
			if(typeof action == 'string')
			  eval(`currAnimList[i].${action}()`);
			if(typeof action == 'function')
				action(currAnimList[i]);
		}
}
animation_PIXI.endAllAnims = function(animListArg) {
	let currAnimList = animListArg||animList;
	for(let i = 0; i < currAnimList.length; i++)
		if(currAnimList[i]) currAnimList[i].endAnim();
};
animation_PIXI.removeAllAnims = function(animListArg) {
	let currAnimList = animListArg||animList;
	for(let i = 0; i < currAnimList.length; i++)
		if(currAnimList[i]) currAnimList[i].removeAnim();
};
animation_PIXI.stopAudioOnAllAnims = function(animListArg) {
	let currAnimList = animListArg||animList;
	for(let i = 0; i < currAnimList.length; i++)
		if(currAnimList[i]) currAnimList[i].stopAudioChannel();
};
animation_PIXI.breakAllAnims = function(animListArg) {
	let currAnimList = animListArg||animList;
	for(let i = 0; i < currAnimList.length; i++)
		if(currAnimList[i]) currAnimList[i].breakAnim();
};

function spineAnim(animData, callbackArg, PIXI_HandleArg, szAnimListNameArg) {
	const emptyFunction = ()=>{};
	let thisObj = this;
	let spineObj = new PIXI.spine.Spine(animData.spineData);
	let callback = callbackArg||emptyFunction;
	let PIXI_Handle = PIXI_HandleArg||CTG_PIXI;
	let X = animData.x+(animData.offsetX||0)||PIXI_Handle.renderer.width/2,
		Y = animData.y+(animData.offsetY||0)||PIXI_Handle.renderer.height/2;
	let audioChannel = null;
	let endTimer = null;
	let playLoopAnimCallback = null;
	let isEnded = false;
	addToAnimList();
	innerMaskOfCTG_PIXI.removeOldMask();
	this.spine = spineObj;
  this.startAnim = startAnim;
	this.endAnim = endAnim;
	this.removeAnim = removeAnim;
	this.fadeAudioChannel = fadeAudioChannel;
	this.stopAudioChannel = stopAudioChannel;
	this.replaceAnimCompleteHandler = replaceAnimCompleteHandler;
	this.stopAnim = stopAnim; //visualy stop animation;
	this.isEnded = getEndedState;
	this.breakAnim = breakAnim; //completely stop and remove animation;

	function startAnim(animNameArg, loopNameArg) {
		const animName = animNameArg||animData.defaultAnim;
		//Display PIXI renderer >>>
		if(PIXI_Handle===CTG_PIXI)
			CTG_PIXI.renderer.view.style.display = "block";

		//Perform actions to play animation... >>>
		for(let property in animData[animName])
			animData[property] = animData[animName][property];
		const loopAnim = loopNameArg||animData.loopAnim,
			speedCoef = animData.speedCoef, scale = animData.scale;
		if(loopAnim) {
			playLoopAnimCallback = ()=>{
				spineObj.state.setAnimation(0, loopAnim, true);
			};
		}
		if(speedCoef) spineObj.state.timeScale = speedCoef;
		if(scale) spineObj.scale.set(scale);
		spineObj.position.set(X, Y);
    spineObj.state.setAnimation(0, animName, false);
		//spineObj.state.tracks[0].trackTime = startTime||0;
		PIXI_Handle.stage.addChild(spineObj);
		spineObj.state.addListener({complete: endAnim});
		if(animData.slowShowing) {
			spineObj.alpha = 0.0;
			let intervalVar = setInterval(function() {
				if(spineObj.alpha >= 1.0) {
					spineObj.alpha = 1.0;
					clearInterval(intervalVar);
					intervalVar = null;
				}
				else spineObj.alpha += 0.1;
			}, 40);
		}
		if(window.self.soundOn && animData.sound) {
			audioChannel = createjs.Sound.play(animData.sound);
			if(animData.stopAnimOnSoundEnd)
				audioChannel.addEventListener('complete', endAnim);
		}
		if(animData.maxAnimTime)
			endTimer = setTimeout(endAnim, animData.maxAnimTime);
		if(!animData.nonstopAttraction) {
			$(document).on("keyup", _onKeyup);
			$(st).on(ck, endAnim);
		}
	}

	function endAnim() {
		isEnded = true;
		spineObj.state.listeners = [];
		if(animData.autoRemove) setTimeout(removeAnim, 0);

		if(audioChannel) {
			if(animData.soundFading)
				fadeAudioChannel();
			else
				stopAudioChannel();
			if(animData.stopAnimOnSoundEnd)
				audioChannel.removeAllEventListeners();
		}
		if(animData.maxAnimTime)	clearTimeout(endTimer);
		if(!animData.nonstopAttraction) {
			$(document).off("keyup", _onKeyup);
			$(st).off(ck, endAnim);
		}
		setTimeout(callback,0);

		if(playLoopAnimCallback) {
			playLoopAnimCallback();
			//replaceAnimCompleteHandler(playLoopAnimCallback);
		}
	}

	function removeAnim() {
		if(animData.fading) {
			let intervalVar = setInterval(function() {
				if(spineObj.alpha <= 0.0) {
					spineObj.alpha = 1.0;
					fadingEnd();
					clearInterval(intervalVar);
					intervalVar = null;
				}
				else spineObj.alpha -= 0.1;
			}, 100);
		}
		else fadingEnd();

		function fadingEnd() {
			spineObj.state.clearTracks(); // Stop all animations
			spineObj.state.listeners = [];
			PIXI_Handle.stage.removeChild(spineObj);
			spineObj.destroy({
			  children: true,
			  texture: false,
			  baseTexture: false
			});
			removeFromAnimList();
			if(!animList.length && PIXI_Handle===CTG_PIXI) CTG_PIXI.renderer.view.style.display = "none";
		}
	}

	function fadeAudioChannel() {
		_fadeAudioChannel(audioChannel);
	}
	function stopAudioChannel() {
		_stopAudioChannel(audioChannel);
	}

	function replaceAnimCompleteHandler(newCallback) {
		spineObj.state.listeners = [];
		spineObj.state.addListener({complete: newCallback});
	}

	function stopAnim() {
		spineObj.state.clearTracks(); // Stop all animations
	}
	function addToAnimList() {
		if(PIXI_Handle===CTG_PIXI)
			_addToAnimList(thisObj);
		if(szAnimListNameArg)
		  _addToAnimList(thisObj, szAnimListNameArg);
	}
	function removeFromAnimList() {
		_removeFromAnimList(thisObj);
		if(szAnimListNameArg)
			_removeFromAnimList(thisObj, szAnimListNameArg);
	}

	function getEndedState() {
		return isEnded;
	}
	function breakAnim() {
		if(!isEnded) endAnim();
		if(!animData.autoRemove) removeAnim();
	}
}

function removeAllStageContent(stage) {
	for (let i = stage.children.length - 1; i >= 0; i--)
		stage.removeChild(stage.children[i]);
}
