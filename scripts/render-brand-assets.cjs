// Renders assets/brand/mark.svg into the app icon, splash and Android icons.
// Usage (needs @resvg/resvg-js, not a project dependency): node scripts/render-brand-assets.cjs assets/brand/mark.svg assets/images
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');
const [, , svgPath, outDir] = process.argv;
const base = fs.readFileSync(svgPath, 'utf8');
const inner = base.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const render = (svg, size, file) => {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(file, size, png.length);
};
// iOS app icon: full bleed square (iOS masks the corners).
render(base, 1024, 'icon.png');
render(base, 48, 'favicon.png');
// Splash: the mark as a rounded tile on a transparent canvas.
const tile = (r) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><clipPath id="tile"><rect width="1024" height="1024" rx="${r}"/></clipPath></defs><g clip-path="url(#tile)">${inner}</g></svg>`;
render(tile(230), 512, 'splash-icon.png');
// Android adaptive: background = sky/ground, foreground = same art scaled into the 66% safe zone.
render(base, 512, 'android-icon-background.png');
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><clipPath id="c"><circle cx="512" cy="512" r="340"/></clipPath></defs><g clip-path="url(#c)"><g transform="translate(172 172) scale(0.664)">${inner}</g></g></svg>`;
render(fg, 512, 'android-icon-foreground.png');
const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(172 172) scale(0.664)"><circle cx="512" cy="604" r="196" fill="#000" clip-path="inset(0 0 420 0)"/><polygon points="494,604 504,604 236,1024 176,1024" fill="#000"/><polygon points="520,604 530,604 848,1024 788,1024" fill="#000"/><rect x="0" y="596" width="1024" height="16" fill="#000"/></g></svg>`;
render(mono, 432, 'android-icon-monochrome.png');
