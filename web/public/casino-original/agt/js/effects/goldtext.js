class GoldNumText extends Phaser.BitmapText {
    constructor(x, y, font, text, size, align) {
        super(game, x, y, 'agt_gold_nums', text, size, align);
    }
}
class GoldText extends Phaser.Text {
    constructor(x,y,text,isParent=true,isLast=false) {

        super(game,x,y,text);

        this.fontSize = `160pt`;
        // this.font= "Arial Black";
        this.font= "Teko";
        this.fill = '#8b8c43';
        this.wordWrap = false;

        if(isLast) {
            this.stroke = '#ffffff';
            this.strokeThickness = 4;

            var golGradient = this.context.createLinearGradient(0, 0, 0, this.height);

            golGradient.addColorStop(0, '#F9F9F9');
            golGradient.addColorStop(0.44, '#FBEFA9');
            golGradient.addColorStop(0.45, '#6C3116');
            golGradient.addColorStop(0.74, '#F5D95C');
            golGradient.addColorStop(0.74, '#FFE76C');
            golGradient.addColorStop(1, '#FCF9CA');
            this.fill=golGradient;
            this.setShadow(2, 3, 'rgba(65,35,0,1)', 0.5);

            /*this.tw=game.add.tween(this.style)
                .to( {shadowOffsetX: -2 }, 1000, Phaser.Easing.Linear.None, true,0,-1,false);

            this.k=-1.5;

            this.tw.onUpdateCallback(function(){
                this.style.shadowOffsetY=this.style.shadowOffsetX*this.k;
                this.dirty=true;
            }, this);

            this.tw.onLoop.add(function(){

                this.k=this.k*-1;

                console.log('this.style.shadowOffsetX',this.style.shadowOffsetX);
                console.log('this.style.shadowOffsetY',this.style.shadowOffsetY);

            },this);

            console.log(this.tw);*/
        }
        else if(isParent) {
            let size=15;
            this.fill='rgba(0,0,0,0)';
            for(var i = 1; i < size; i++){
                let s=new GoldText(i,i,text,false);
                s.anchor.set(0.5,0.5);
                this.addChild(s);
            }
            this.lastPart=new GoldText(0,0,text,false,true);
            this.lastPart.anchor.set(0.5,0.5);
            this.addChild(this.lastPart);
        }
        else {
            var golGradient = this.context.createLinearGradient(0, 0, 0, this.height);

            golGradient.addColorStop(0, '#904F04');
            golGradient.addColorStop(0.15, '#904F04');
            golGradient.addColorStop(0.25, '#541001');
            golGradient.addColorStop(0.5, '#AE6B05');
            golGradient.addColorStop(0.56, '#8B4D10');
            golGradient.addColorStop(0.62, '#5A1802');
            golGradient.addColorStop(0.66, '#5A1802');
            golGradient.addColorStop(0.75, '#8B4D10');
            golGradient.addColorStop(0.8, '#FEE56E');
            golGradient.addColorStop(0.95, '#905000');
            golGradient.addColorStop(1, '#905000');

            this.fill=golGradient;
        }

        //
        // if(!isParent) {
        //     let defAncSet=this.anchor.set;
        //
        //     this.anchor.set = function(x,y) {
        //         defAncSet(x,y);
        //     }.bind(this);
        // }

    }
    set fontSize(value) {
        value = value || '0';

        if (typeof value === 'number')
        {
            value = value + 'px';
        }

        this._fontComponents.fontSize = value;
        this.updateFont(this._fontComponents);

        this.children.length>0 && this.children.forEach(function(c) {
            c._fontComponents.fontSize=value;
            c.updateFont(c._fontComponents);
        });
    }
    set text(txt_value) {

        if(this._text==txt_value) {
            return;
        }

        this._text=txt_value;
        this.children.length>0 && this.children.forEach(function(c) {
            c.text=txt_value;
        });
        if(this._text!='') {
            this.updateText();
        }
    }
    get text() {
        return this._text;
    }
    /*text(txt) {
        this.text_plain=txt;
        this.redraw();
    }*/
    /*redraw() {
        this.tt.text=this.text_plain;
        this.tt.children.forEach(function(c) {
            c.text=this.text_plain;
        }.bind(this));
    }
    drawText(x,y) {

        let text = game.add.text(x, y, this.text_plain);
        text.fontSize = `160pt`;
        text.font= "Arial Black";
        text.font= "Teko";
        text.fill = '#8b8c43';
        text.align = 'center';
        // text.setShadow(2, 3, 'rgba(65,35,0,1)', 0.5);
        text.wordWrap = false;

        var golGradient = text.context.createLinearGradient(0, 0, 0, text.height);

        golGradient.addColorStop(0, '#904F04');
        golGradient.addColorStop(0.15, '#904F04');
        golGradient.addColorStop(0.25, '#541001');
        golGradient.addColorStop(0.5, '#AE6B05');
        golGradient.addColorStop(0.56, '#8B4D10');
        golGradient.addColorStop(0.62, '#5A1802');
        golGradient.addColorStop(0.66, '#5A1802');
        golGradient.addColorStop(0.75, '#8B4D10');
        golGradient.addColorStop(0.8, '#FEE56E');
        golGradient.addColorStop(0.95, '#905000');
        golGradient.addColorStop(1, '#905000');

        text.fill=golGradient;

        return text;
    }*/


}
