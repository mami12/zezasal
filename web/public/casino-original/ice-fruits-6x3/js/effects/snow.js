class Snow extends Phaser.Group {
    constructor(w = 200, h = 200) {
        super(game);
        this.w = w;
        this.h = h;
        this.name = 'snow';
        this.lastFlake = null;
        //
        //
        //
        this.makeFlakes();

        this.speed_mode_toggle = false;

        eventDispatcher.removeAll(this);
        eventDispatcher.add(this.gotEvent, this);
    }
    gotEvent(call, params) {
        if (call == G.CHOOSE_SELECTED && !this.speed_mode_toggle) {
            this.speed_mode_toggle = true;
            this.children.forEach(function(c) {
                c.fallSpeed *= 3;
            });
        }

        if (call == G.END_FREEGAMES && this.speed_mode_toggle) {
            this.speed_mode_toggle = false;
            this.children.forEach(function(c) {
                c.fallSpeed /= 3;
            });
        }
    }
    makeFlakes() {
        for (var i = 0; i < 250; i++) {
            var flake = new Flake(this.w, this.h);

            //if the last flake exists
            //place it as the prev flake
            if (this.lastFlake != null) {
                flake.prevFlake = this.lastFlake;
            }

            this.lastFlake = flake;
            this.add(flake);
        }

        if (C.snow_dynamic) {

            this.spd_k = 1;

            var snow_k = 1;
            if (C.snow_speed_k) {
                snow_k = C.snow_speed_k;
            }

            this.spd = 0.2 * snow_k + Math.random() * 2 * snow_k;

            this.runChange();
        }
    }
    update() {
        this.lastFlake.fallSpeed += this.spd;
        this.lastFlake.move();
    }
    runChange() {
        var snow_k_min = 0.4;
        var snow_k_max = C.snow_speed_k || 3;

        var rnd = game.rnd.realInRange(snow_k_min, snow_k_max);

        this.spd = 0.2 * rnd + Math.random() * 2 * rnd;

        this.spd *= this.spd_k;

        if (this.spd_k > 0) {
            this.spd_k = -1;
        } else {
            this.spd_k = 1;
        }

        game.time.events.add(game.rnd.integerInRange(4000, 8000), this.runChange, this);
    }
}

class Flake extends Phaser.Group {
    constructor(w, h) {
        super(game);
        //        var f = game.add.graphics();
        //        f.beginFill(0xffffff, 1);
        //        f.drawCircle(0, 0, 10);
        //        f.endFill();
        //        this.add(f);


        var f = this.create(0, 0, 'snowflake', game.rnd.integerInRange(0, 5));
        if (C.snow_tint) {
            f.tint = C.snow_tint;
        }

        this.w = w;
        this.h = h;

        var snow_k = 1;
        if (C.snow_speed_k) {
            snow_k = C.snow_speed_k;
        }

        this.x = game.rnd.integerInRange(0, w);
        this.y = game.rnd.integerInRange(0, h);
        this.drift = game.rnd.integerInRange(-1, 1) * (.05 + Math.random() * .1);
        this.fallSpeed = 0.2 * snow_k + Math.random() * 2 * snow_k;
        this.scale.x = (C.snow_scale_k || 0.1) + Math.random();
        this.scale.y = this.scale.x;
        this.alpha = .1 + Math.random();
    }
    move() {

        this.w = C.canvas_width * model.bg.scale.x;
        this.h = model.bg.height;

        this.x += this.drift;
        this.y += this.fallSpeed;
        if (this.y > this.h) {
            this.y = -10;
        }
        if (this.prevFlake) {
            this.prevFlake.move();
        }
    }
}