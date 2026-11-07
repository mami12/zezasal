/********** ALEKSANDAR ACHEV (Video) **********/
console.log("<<<<<<<<<< CT Gaming - Video library - ver 2.36 08.08.2025 >>>>>>>>>>");

//import { getOS, opera_mini } from './casino_settings.min.js'; //regulation==="ke" && (nua.indexOf('Opera Mini') > -1 || nua.indexOf('OPR/') > -1)
//export { fetchVideo, loadSVG_Ae, videoClass };
const missingWebmSupport = ["MacOS", "iOS"].includes(getOS()) || isSamsungGalaxyS()&&isAndroid8() || opera_mini;

function isSamsungGalaxyS() {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes("samsung") && userAgent.includes("sm-g");
}
function isAndroid8() {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('android') && userAgent.includes('android 8');
}

async function fetchVideo(videoData, callback) {
  if(videoData["type"] === "imageArchive") {
    if(videoData.animCanBeMissed) setTimeout(callback, 0);
    const response = await fetchFile(videoData.jsonSrc);
    videoData.base64DataObj = videoData.compressed?
      (JSON.parse(pako.inflate(await response.arrayBuffer(), { to: 'string' }))):
      (await response.json());
    videoData.imgDataObj = {};
    videoData.assetsCounter = 0;
    for(let animName in videoData.base64DataObj) {
      const resultArray = [];
      const srcArray = videoData.base64DataObj[animName];
      for(let i = 0; i < srcArray.length; i++) {
        const img = new Image();
        img.onload = img.onerror = ()=>{
          if(++videoData.assetsCounter === resultArray.length) {
            videoData.assetsLoaded = true;
            if(!videoData.animCanBeMissed) setTimeout(callback, 0);
          }
        };
        img.src = srcArray[i];
        resultArray[i] = img;
      }
      videoData.imgDataObj[animName] = resultArray;
    }
  }
  else if(missingWebmSupport || !videoData["webmSrc"]) {
    if(videoData.animCanBeMissed) setTimeout(callback, 0);
    const response = await fetchFile(videoData.lottieSrc);
    const json = videoData.compressedLottieFile?
      (JSON.parse(pako.inflate(await response.arrayBuffer(), { to: 'string' }))):
      (await response.json());
    videoData.lottieJSON_Assets = [];
    videoData.lottieAssetsCounter = 0;
    json.assets.forEach(function(val) {
      if(val.p) {
        if(val.u!="") val.u = `${videoData.lottieSrc.split('/').slice(0, -1).join('/')}/${val.u}`;
        let img = new Image();
        const imgIndex = videoData.lottieJSON_Assets.length;
        img.onload = ()=>{
          if(++videoData.lottieAssetsCounter === videoData.lottieJSON_Assets.length)
            lottieAssets_LoadHandler();
        };
        img.onerror = ()=>{
          console.error(`error with img #${imgIndex}`, img.src);
          if(++videoData.lottieAssetsCounter === videoData.lottieJSON_Assets.length)
            lottieAssets_LoadHandler();
        }
        img.src = val.u+val.p;
        videoData.lottieJSON_Assets.push(img);
      }
    });
    if(!videoData.lottieJSON_Assets.length) lottieAssets_LoadHandler();
    videoData.lottieJSON = json;

    function lottieAssets_LoadHandler() {
      videoData.lottieAssetsLoaded = true;
      if(!videoData.animCanBeMissed) setTimeout(callback, 0);
    }
  }
  else setTimeout(callback, 0);

  async function fetchFile(path) {
    try {
      const response = await fetch(path);
      if(!response.ok) {
        throw new Error("Network response was not OK");
      }
      return response;
    } catch(error) {
      console.error("There has been a problem with your fetch operation:", error);
    }
  }
}

function loadSVG_Ae(jsonData, animParentElem) {
  let params = {
    container: animParentElem,
    renderer: 'canvas',
    loop: false,
    autoplay: false,
    animationData: jsonData
  };
  return lottie.loadAnimation(params);
}

const videoList = [];
function videoClass(videoData, videoParentElem, callbackArg/*optional*/, startAnimCallbackArg/*optional*/, loopEndCallbackArg/*optional*/) { //class constructor function
  const emptyFunction = ()=>{};
  let thisObj = this;
	let callback = ()=>{
    (callbackArg||emptyFunction)();
    if(videoData.loop) {
      playLoopAnim();
      callback = playLoopAnim;
    }
    else if(videoData.autoRemove) thisObj.remove();
  };
  let loopEndCallback = ()=>{
    (loopEndCallbackArg||emptyFunction)();
    if(videoData.autoRemove) thisObj.remove();
  };
	let startTime, endTime, frameRate, deltaTime; //deltaTime - one frame length in seconds
	let videoRGBA, isPlaying = false;
  let lottieAnim, lottieLoaded = false, lottieFrame;
  let isRemoved = false;
  let loopIndex = 0;
  let timeout, fallbackTimeout;

  addToVideoList();
	if(missingWebmSupport || !videoData["webmSrc"]) {
    if(videoData.lottieAssetsLoaded) {
      lottieFrame = document.createElement('div');
      setDimensions(lottieFrame, videoData.dim)
      if(videoData.maskingPercent) setMask(lottieFrame, videoData.maskingPercent);
      if(videoData.slowShowing) setShowingAnim(lottieFrame, videoData.slowShowing);
      videoParentElem.appendChild(lottieFrame);
      lottieAnim = loadSVG_Ae(videoData.lottieJSON, lottieFrame);
      frameRate = lottieAnim.frameRate;
      deltaTime = (1000/frameRate)/1000;
      //console.log(lottieAnim);
      lottieAnim.addEventListener('loaded_images', ()=>{lottieLoaded = true;});
    }
    else {
      isRemoved = true;
      setTimeout(loopEndCallbackArg?loopEndCallbackArg:callbackArg, 0);
    }
	}
	else {
    videoRGBA = document.createElement('video');
    $(videoRGBA).attr('muted', 'true');
    $(videoRGBA).attr('width', videoData.width);
    $(videoRGBA).attr('height', videoData.height);
    $(videoRGBA).attr('crossorigin', 'anonymous');
    $(videoRGBA).css("display", "none");
    setDimensions(videoRGBA, videoData.dim)
    if(videoData.maskingPercent) setMask(videoRGBA, videoData.maskingPercent);
    if(videoData.slowShowing) setShowingAnim(videoRGBA, videoData.slowShowing);
    let source = document.createElement('source');
    $(source).attr('type', 'video/webm');
    $(source).attr('src', videoData.webmSrc);
    videoParentElem.appendChild(videoRGBA);
    videoRGBA.appendChild(source);
		videoRGBA.addEventListener('error', (/*errorData*/)=>{
      /*if(errorData.path && errorData.path[0]) errorData = errorData.path[0].error;
      if(errorData.originalTarget) errorData = errorData.originalTarget.error;
      console.error(`Video error: ${errorData.message}`, errorData);*/ //doesn't work
      console.error(`Video loading error! src: ${videoData.webmSrc}`);
      errorHandler();
    }, true);
    //videoRGBA.addEventListener('play', ()=>{console.log("play")}, true);
    //videoRGBA.addEventListener('waiting', ()=>{console.log("lagging")}, true);
    //videoRGBA.addEventListener('pause', ()=>{console.log("pause")}, true);
    frameRate = 1000/(videoData.speed||40);
    deltaTime = (1000/frameRate)/1000;
	}

  function setDimensions(element, dim) {
    if(dim) $(element).css({"position":"absolute","left":dim[2],"top":dim[3],"width":dim[0],"height":dim[1],"z-index":dim[4]});
    else $(element).css({"position":"absolute","left":"0px","top":"0px","width":"100%","height":"100%","z-index":"999"});
  }

  function setMask(element, maskingPercent) {
    const maskImageStr = `linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) ${maskingPercent}%, rgba(0, 0, 0, 1) ${100-maskingPercent}%, rgba(0, 0, 0, 0) 100%), linear-gradient(to right, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) ${maskingPercent}%, rgba(0, 0, 0, 1) ${100-maskingPercent}%, rgba(0, 0, 0, 0) 100%`;
    $(element).css({
      "-webkit-mask-image": maskImageStr,
      "mask-image": maskImageStr,
      "-webkit-mask-composite": "destination-in",
      "mask-composite": "intersect"
    });
  }

  function setShowingAnim(element, duration) {
    $(element).css("-webkit-animation", `showingAnim ${duration}ms 1 ease-in forwards`);
  }

  function setHidingAnim(element, duration, callback1) {
    $(element).css("-webkit-animation", `hidingAnim ${duration}ms 1 ease-in forwards`);
    setTimeout(callback1, duration);
  }

  let bVideoFailed = false; //function below must be executed only once
  function errorHandler() {
    if(bVideoFailed) return;
    bVideoFailed = true;
    if(!isRemoved) thisObj.remove();
    (loopEndCallbackArg?loopEndCallback:callback)();
  }

  function onKeyup(e) {
    switch(e.keyCode || e.which) {
      case 32/*SPACEBAR key*/:
      case 13/*ENTER key*/:
        $("#buttonStart").click();
        break;
    }
  }

  function frameToTimeMoment(frame, frameRate) {//result is in seconds
    return frame/frameRate;
  }

  function timeMomentToFrame(time/*in seconds*/ , frameRate) {
    return frameRate*time;
  }

  function playLoopAnim() {
    //console.log("playLoopAnim", videoData);
    if(isRemoved) return;
    if(videoData.loop[2]) {
      if(loopIndex < videoData.loop[2])
        thisObj.playFrames(videoData.loop[0], videoData.loop[1]);
      else if(loopIndex === videoData.loop[2] && videoData.loop[3] && videoData.loop[4])
        thisObj.playFrames(videoData.loop[3], videoData.loop[4]);
      else /*loopIndex > videoData.loop[2]*/
        loopEndCallback();
      loopIndex++;
    }
    else
      thisObj.playFrames(videoData.loop[0], videoData.loop[1]);
  }

  function skipAnim() {
    //IF videoData.loop[5] THEN loopEndCallback() ELSE playExitLoopAnim()
    if(videoData.loop && videoData.loop[2]) loopIndex = videoData.loop[2]+(videoData.loop[5]?1:0);
    thisObj.stop();
  }

	function checkVideoEnd() {
		if(videoRGBA.currentTime >= endTime-deltaTime) thisObj.stop();
	}

  function playLottieAnim(startTimeParam, endTimeParam) {
    //IF videoData.loop[6] THEN playLottieAnim_ReversedLoop() ELSE playLottieAnim()
    if(videoData.loop && videoData.loop[6] && loopIndex%2 && loopIndex<videoData.loop[2])
      lottieAnim.playSegments([timeMomentToFrame(endTimeParam, frameRate)||lottieAnim.totalFrames,
        timeMomentToFrame(startTimeParam, frameRate)], true);
    else
      lottieAnim.playSegments([timeMomentToFrame(startTimeParam, frameRate),
        timeMomentToFrame(endTimeParam, frameRate)||lottieAnim.totalFrames], true);
  }

  this.getDuration = function() {
    return (missingWebmSupport||!videoData["webmSrc"])?(lottieAnim.totalFrames/lottieAnim.frameRate):(videoRGBA.duration);
  }

  this.getCurrentTime = function() {
    return (missingWebmSupport||!videoData["webmSrc"])?(lottieAnim.currentFrame/lottieAnim.frameRate):(videoRGBA.currentTime);
  }

  this.playFrames = function(startFrameParam, endFrameParam) {
    thisObj.play(frameToTimeMoment(startFrameParam, frameRate),
      frameToTimeMoment(endFrameParam, frameRate));
  }

  this.play = function(startTimeParam, endTimeParam) {
    if(isRemoved) {console.log("Video element can't be handled cause he doesn't exist anymore!"); return;}
		startTime = startTimeParam||(videoData.start?frameToTimeMoment(videoData.start[0], frameRate):0);
		endTime = endTimeParam||(videoData.start?frameToTimeMoment(videoData.start[1], frameRate):0);

    if(missingWebmSupport || !videoData["webmSrc"]) {
      lottieAnim.addEventListener('complete', thisObj.stop);
      if(/*lottieAnim.isLoaded*/lottieLoaded) {
        if(startAnimCallbackArg) {startAnimCallbackArg(); startAnimCallbackArg = null;}
        playLottieAnim(startTime, endTime);
      } else lottieAnim.addEventListener('loaded_images', ()=>{
        if(isRemoved) return;
        lottieLoaded = true;
        if(startAnimCallbackArg) {startAnimCallbackArg(); startAnimCallbackArg = null;}
        playLottieAnim(startTime, endTime);
        lottieAnim.removeEventListener('loaded_images');
      });
      if(videoData.manageParentDisplay) videoParentElem.style.display = "block";
  	}
    else {
      //console.log("trying to start video");
      fallbackTimeout = setTimeout(()=>{console.log("Video fallback timeout expired!");errorHandler();}, 5000);
      videoRGBA.currentTime = startTime;
      let playPromise = videoRGBA.play();
  		if(playPromise !== undefined) {
  			playPromise.then(function(){
          //console.log("Video promise is resoved!");
          clearTimeout(fallbackTimeout);
          if(isRemoved) return;
  				if(!isPlaying) {
  					isPlaying = true;
            if(startAnimCallbackArg) {startAnimCallbackArg(); startAnimCallbackArg = null;}
            //console.log("video start playing");
            setTimeout(()=>{
              if(isRemoved) return;
              if(endTime && endTime<videoRGBA.duration-deltaTime){
                //console.log(endTime-startTime-deltaTime);
                timeout = setTimeout(thisObj.stop, (endTime-startTime-deltaTime)*1000);
                //videoRGBA.addEventListener('timeupdate', checkVideoEnd, false); //"useCapture"(3th Param) MUST NOT BE "true"
              }
              videoRGBA.addEventListener('ended', thisObj.stop);
            }, 40);
            videoRGBA.style.display = "block";
            if(videoData.manageParentDisplay) videoParentElem.style.display = "block";
  				}
          else console.log(videoRGBA, "Video is already playing!");
  			})
  			.catch(()=>{console.error("Video promise is rejected!");clearTimeout(fallbackTimeout);errorHandler();});
  		} else {console.error("Video promise is undefined!");clearTimeout(fallbackTimeout);errorHandler();}
      //console.log(playPromise);
    }
    if(!videoData.nonstopAttraction && !(videoData.loop&&loopIndex===videoData.loop[2])) {
      $(document).on("keyup", onKeyup);
      $("#buttonStart").on("click", skipAnim);
    }
	}

	this.stop = function() {
    if(isRemoved) {console.log("Video element can't be handled cause he doesn't exist anymore!"); return;}
    if(missingWebmSupport || !videoData["webmSrc"]) {
      lottieAnim.removeEventListener('complete', thisObj.stop);
      //lottieAnim.stop(); //go to first frame
      //lottieAnim.goToAndStop(endTime, false); //go to last frame
      setTimeout(callback, 0);
  	}
    else {
      if(isPlaying) {
        isPlaying = false;
        clearTimeout(timeout);
        //videoRGBA.removeEventListener('timeupdate', checkVideoEnd, false); //"useCapture"(3th Param) MUST NOT BE "true"
        videoRGBA.removeEventListener('ended', thisObj.stop);
        videoRGBA.pause();
        setTimeout(callback, 0);
      }
      else console.log(videoRGBA, "Video is not playing and can't be stoped!");
    }
    if(!videoData.nonstopAttraction) {
      $(document).off("keyup", onKeyup);
      $("#buttonStart").off("click", skipAnim);
    }
	}

	this.remove = function() { //class destructor function
    //console.log("remove", videoData);
    if(isRemoved) {console.log("Video element can't be handled cause he doesn't exist anymore!"); return;}
    if(missingWebmSupport || !videoData["webmSrc"]) {
      if(videoData.fading && !bVideoFailed)
        setHidingAnim(lottieFrame, videoData.fading, fadingEnd);
      else fadingEnd();
      function fadingEnd() {
        lottieAnim.destroy();
        lottieFrame.remove();
      }
		}
		else {
      if(videoData.fading && !bVideoFailed)
        setHidingAnim(videoRGBA, videoData.fading, fadingEnd);
      else fadingEnd();
      function fadingEnd() {
        clearTimeout(timeout);
        videoRGBA.remove();
      }
		}
    if(videoData.manageParentDisplay && !videoParentElem.children.length) videoParentElem.style.display = "none";
    removeFromVideoList();
    isRemoved = true;
	}

  this.replaceVideoEndHandler = function(newCallback) {
    if(isRemoved) {console.log("Video element can't be handled cause he doesn't exist anymore!"); return;}
    callback = newCallback||emptyFunction;
  }

  function addToVideoList() {
    if(videoData && [videos["backgroundAnim"],videos["backgroundAnimFg"]].includes(videoData)) return;
    let i;
    for(i = 0; i < videoList.length; i++) {
      if(!videoList[i]) {
        videoList[i] = thisObj;
        break;
      }
    }
    if(i===videoList.length) videoList.push(thisObj);
  }
  function removeFromVideoList() {
    for(let i = 0; i < videoList.length; i++) {
      if(videoList[i]===thisObj) {
        delete videoList[i];
        break;
      }
    }
    while(!videoList[videoList.length-1] && videoList.length>0) videoList.length--;
  }
}
videoClass.stopAll = function() {
  for(let i = 0; i < videoList.length; i++) if(videoList[i]) videoList[i].stop();
}
videoClass.removeAll = function() {
  for(let i = 0; i < videoList.length; i++) if(videoList[i]) videoList[i].remove();
}
