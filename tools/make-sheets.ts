/**
 * Guard rail for the old procedural sheet generator.
 *
 * This command used to overwrite the authored manga PNGs in public/sprites
 * with capsule/ellipse placeholder players. That is exactly the regression the
 * current art pass must prevent, so this tool now fails loudly instead of
 * writing files. Use `npm run sprite:enrich:manga` for the accepted manga
 * in-between workflow, followed by `npm run sprite:sanitize:pil`.
 */

throw new Error(
  [
    'Refusing to generate procedural vector player sheets.',
    'The committed Super Volley 90 player art is manga raster art in public/sprites.',
    'Use: npm run sprite:enrich:manga && npm run sprite:sanitize:pil',
  ].join('\n'),
);
