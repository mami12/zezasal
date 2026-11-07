class Smoke extends Phaser.Group {
    constructor() {
        super(game);
        this.started=false;
        this.load();
        eventDispatcher.add(this.gotEvent,this);
    }
    gotEvent(call,params) {
        if(!this.started){
            return;
        }
        if(call==G.CHOOSE_SELECTED) {
            this['smokeEmitternormal'].visible=false;
            this['smokeEmitterfg'].visible=true;
        }

        if(call==G.END_FREEGAMES) {
            this['smokeEmitternormal'].visible=true;
            this['smokeEmitterfg'].visible=false;
        }
    }
    load() {
        if(!game.cache.checkImageKey('smoke')) {
            game.load.image('smoke', 'images/common/ui/smoke.'+ C.ext);

            game.load.onFileComplete.add(function (s,f) {
                if(game.cache.checkImageKey('smoke')) {
                    this.start();
                }
            },this);

            game.load.start();
        }
    }
    start(type='normal',LIFECYCLE = 6000) {

        let flag='started'+type;

        if(this[flag]) {
            return;
        }

        this[flag]=true;

        let Y=C.canvas_height*0.9;

        if(type=='fg') {
            Y=C.canvas_height*0.7;
        }

        // Create a particle emitter along the bottom of the stage
        const emitter = game.add.emitter(game.world.centerX, Y, 150);

        this['smokeEmitter'+type]=emitter;

        this.add(emitter);
        model.mainLayer.addAt(this,0);

        emitter.width = game.width;

        // Particle behaviour ranges to create a smoke drift-like effect
        emitter.minParticleScale = 0.1;
        emitter.maxParticleScale = 0.9;
        emitter.minRotation = -5;
        emitter.maxRotation = 5;
        emitter.setYSpeed(-2, -5);
        emitter.setXSpeed(10, 20);
        emitter.gravity = -4;

        if(type=='fg') {
            emitter.setYSpeed(0, 0);
            emitter.setXSpeed(0, 0);
            emitter.gravity = 0;
        }

        // Particle alpha will ease from 0 to 0.2 and back again, for fade in/out
        emitter.setAlpha(0, 0.5, LIFECYCLE, Phaser.Easing.Quadratic.InOut, true);

        // Start the emitter
        emitter.makeParticles('smoke');
        emitter.start(false, LIFECYCLE*2, 100, 0);

        if(type=='normal') {
            this.start('fg');
            emitter.visible=false;
        }

    }
}