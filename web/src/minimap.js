// Top-down minimap: profile polyline, user position and view direction.
export class Minimap {
  constructor(canvas, points) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = points; // [[e, n], ...]

    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const [e, n] of points) {
      minE = Math.min(minE, e); maxE = Math.max(maxE, e);
      minN = Math.min(minN, n); maxN = Math.max(maxN, n);
    }
    this.center = { e: (minE + maxE) / 2, n: (minN + maxN) / 2 };
    this.halfSpan = Math.max((maxE - minE) / 2, (maxN - minN) / 2, 5);
  }

  // user: {e, n}; headingRad: view direction (0 = north, CW positive)
  draw(user, headingRad) {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // auto-zoom to include the user, padded
    let span = this.halfSpan;
    if (user) {
      span = Math.max(span,
        Math.abs(user.e - this.center.e), Math.abs(user.n - this.center.n));
    }
    span *= 1.25;
    const s = Math.min(w, h) / 2 / span;
    const px = (e, n) => [
      w / 2 + (e - this.center.e) * s,
      h / 2 - (n - this.center.n) * s,
    ];

    // profile line
    ctx.beginPath();
    for (let i = 0; i < this.points.length; i++) {
      const [x, y] = px(this.points[i][0], this.points[i][1]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#ffb454';
    ctx.lineWidth = 3;
    ctx.stroke();

    // scale bar (bottom left), nice round meters
    const targetPx = w * 0.3;
    const meters = niceRound(targetPx / s);
    ctx.strokeStyle = '#e8ecf0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, h - 12);
    ctx.lineTo(10 + meters * s, h - 12);
    ctx.stroke();
    ctx.fillStyle = '#e8ecf0';
    ctx.font = '10px sans-serif';
    ctx.fillText(meters + ' m', 12, h - 17);

    // north arrow (top right)
    ctx.save();
    ctx.translate(w - 16, 18);
    ctx.fillStyle = '#e8ecf0';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(5, 6); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.fillText('N', -4, 18);
    ctx.restore();

    // user marker + view cone
    if (user) {
      const [ux, uy] = px(user.e, user.n);
      if (headingRad != null) {
        ctx.save();
        ctx.translate(ux, uy);
        ctx.rotate(headingRad);
        ctx.fillStyle = 'rgba(47, 129, 247, 0.25)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 26, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#2f81f7';
      ctx.beginPath();
      ctx.arc(ux, uy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function niceRound(v) {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  for (const st of steps) if (st >= v) return st;
  return 1000;
}
