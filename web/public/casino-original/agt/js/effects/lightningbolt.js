class Node {
  constructor(x, y, nextNode = null, fork = 0) {
    Object.assign(this, { x, y, nextNode, fork })
  }
}

class LightningBolt {
  constructor(canvas, rand, options) {
    let defaults = {
      originalSegmentLength: canvas.height * 2 / 7 >> 0,
      margin: 50,
      minLengthFactor: 0.025,
      boltColor: `rgba(255, 255, 255, 0.3)`,
      boltWidth: 1,
      glow: true,
      glowLayers: 4,
      glowColor: `hsl(0deg 5% 70% / 0.0%s)`,
      bgColor: `rgb(17, 14, 51)`,
      bgFill: true,
      lineCap: "round",
      forkDepth: 4,
      maxFork: 0,
      nodes: [],
      normalOffset: 0,//0.1,
      normalMultiplier: 3,
      normalDivider: 10,
      normalMin: 0.4,
      flicker: true,
      flickerStops: [
        { distance: 0, color: `rgba(255, 255, 255, 0.1)` },
        { distance: 0.4, color: `rgba(255, 255, 255, 0.05)` },
        { distance: 1, color: `rgba(255, 255, 255, 0)` }
      ],
      direction: 'vertical' // 'vertical' или 'horizontal'
    }

    Object.assign(this, { ...defaults, ...options })

    this.rand = rand
    this.canvas = canvas
    this.width = canvas.width
    this.height = canvas.height

    this.bitmap = game.make.bitmapData(C.canvas_width, C.canvas_height);

    this.ctx = this.bitmap.context;
    this.ctx.lineCap = this.lineCap;

    this.normalFactor = (this.rand() * this.normalMultiplier >> 0) / this.normalDivider + this.normalMin

    this.clear()
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height)
    if (this.bgFill) {
      this.ctx.fillStyle = this.bgColor
      this.ctx.rect(0, 0, this.width, this.height)
      this.ctx.fill()
    }
  }

  stroke(x1, y1, x2, y2) {
    this.ctx.beginPath()
    this.ctx.moveTo(x1, y1)
    this.ctx.lineTo(x2, y2)
    this.ctx.stroke()
  }

  connectNodes(node, width, color) {
    for (let n in node.nextNode) {
      let nextNode = node.nextNode[n]
      this.ctx.strokeStyle = color
      this.ctx.lineWidth = width * (this.maxFork - nextNode.fork)
      this.stroke(node.x, node.y, nextNode.x, nextNode.y)
      this.connectNodes(nextNode, width, color)
    }
  }

  generateSegment(x1, y1, x2, y2, minLength, originalLength, fork = 0, prevNode = null, nextNode = null) {
    let length = Math.hypot(x2 - x1, y2 - y1)

    if (length < minLength) {
      return
    }

    this.maxFork = fork > this.maxFork ? fork : this.maxFork

    let mx = (x1 + x2) / 2
    let my = (y1 + y2) / 2

    let offset = this.normalOffset ? ((this.rand() - 0.5) * this.normalOffset * length) : 0

    let dx = x2 - x1
    let dy = y2 - y1
    let lengthVector = Math.hypot(dx, dy)

    // Изменено для поддержки горизонтального направления
    let normalDx, normalDy;
    if (this.direction === 'vertical') {
      normalDx = -dy / lengthVector
      normalDy = dx / lengthVector
    } else {
      normalDx = dy / lengthVector
      normalDy = -dx / lengthVector
    }

    let normalLength = (this.rand() - 0.5) * this.normalFactor * length

    let px = mx + normalDx * normalLength + offset
    let py = my + normalDy * normalLength
    px >>= 0
    py >>= 0

    let middleNode = new Node(px, py, [nextNode], fork)
    this.nodes.push(middleNode)

    if (nextNode) {
      let index = prevNode.nextNode.findIndex(item => item === nextNode)
      if (index !== -1) {
        prevNode.nextNode.splice(index, 1)
      }
    }

    prevNode.nextNode.push(middleNode)

    if (this.rand() * (this.forkDepth - fork > 0 ? (this.forkDepth - fork) : 0) >> 0) {
      let forkEnd = {
        x: 2 * px - x1 >> 0,
        y: 2 * py - y1 >> 0
      }
      let forkNode = new Node(forkEnd.x, forkEnd.y, [], fork + 1)
      middleNode.nextNode.push(forkNode)
      this.nodes.push(forkNode)
      this.generateSegment(px, py, forkEnd.x, forkEnd.y, minLength, originalLength, fork + 1, middleNode, forkNode)
    }

    this.generateSegment(x1, y1, px, py, minLength, originalLength, fork, prevNode, middleNode)
    this.generateSegment(px, py, x2, y2, minLength, originalLength, fork, middleNode, nextNode)
  }

  gradientFill(x1, y1, x2, y2) {
    let gradient
    if (this.direction === 'vertical') {
      gradient = this.ctx.createRadialGradient(
          (x2 + x1) / 2 >> 0,
          (y2 + y1) / 2 >> 0,
          this.height / 10 >> 0,
          (x2 + x1) / 2 >> 0,
          (y2 + y1) / 2 >> 0,
          this.height - this.margin
      )
    } else {
      gradient = this.ctx.createRadialGradient(
          (x2 + x1) / 2 >> 0,
          (y2 + y1) / 2 >> 0,
          this.width / 10 >> 0,
          (x2 + x1) / 2 >> 0,
          (y2 + y1) / 2 >> 0,
          this.width - this.margin
      )
    }

    for (let stop of this.flickerStops) {
      gradient.addColorStop(stop.distance, stop.color)
    }

    this.ctx.fillStyle = gradient
    this.ctx.fillRect(0, 0, this.width, this.height)
  }

  drawGlow() {
    let i = this.glowLayers
    while (i) {
      this.connectNodes(this.firstNode, Math.pow((i--), 2) / this.glowLayers, this.glowColor.replace("%s", this.glowLayers - i))
    }
  }

  draw() {
    let { x1, y1, x2, y2 } = this.origin

    if (this.flicker) {
      this.gradientFill(x1, y1, x2, y2, this.margin)
    }

    if (this.glow) {
      this.drawGlow()
    }

    this.connectNodes(this.firstNode, this.boltWidth, this.boltColor)
  }

  generate(x, y) {
    x = x ?? this.width
    y = y ?? this.height

    let x1, y1, x2, y2

    if (this.direction === 'vertical') {
      let r=this.rand() - 0.7;
      if(!model.isPortrait() && this.rand()<0.5) {
        r=this.rand() + 0.5;
      }
      if(model.isPortrait()) {
        r=1;
      }
      x1 = (x / 2 + r * x / 2) >> 0
      x2 = x1 + r * x / 2 >> 0
      y1 = this.margin * this.rand() >> 0
      y2 = y - this.margin
    } else {
      // Горизонтальное направление
      y1 = (y / 2 + (this.rand() - 0.5) * y / 2) >> 0
      y2 = y1 + (this.rand() - 0.5) * y / 2 >> 0
      x1 = this.margin * this.rand() >> 0
      x2 = x - this.margin
    }

    this.origin = { x1, y1, x2, y2 }

    let firstNode = new Node(x1 >> 0, y1 >> 0, null, 0)
    let lastNode = new Node(x2 >> 0, y2 >> 0, null, 0)

    firstNode.nextNode = [lastNode]
    this.firstNode = firstNode
    this.nodes.push(firstNode, lastNode)

    this.generateSegment(x1, y1, x2, y2, this.minLengthFactor * this.originalSegmentLength, this.originalSegmentLength, 0, firstNode, lastNode)

    this.draw()
  }
}