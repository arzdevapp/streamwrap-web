const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('app.js', 'utf8');
const match = source.match(/function buildCard\(item\) \{[\s\S]*?\n\}(?=\n\nfunction buildSkeletons)/);
if (!match) throw new Error('buildCard not found');

const context = { IMG_POSTER: 'https://image.test/' };
vm.runInNewContext(`${match[0]}; this.buildCard = buildCard;`, context);

const movie = context.buildCard({ id: 101, title: 'Movie', media_type: 'movie', poster_path: '/movie.jpg' });
if (!movie.includes("onclick=\"playItem(101, 'movie')\"")) {
  throw new Error('Selecting a movie card must open the player directly');
}
if (movie.includes('showDetail(')) {
  throw new Error('Selecting a movie card must not open the detail modal');
}

const tv = context.buildCard({ id: 202, name: 'Series', media_type: 'tv', poster_path: '/tv.jpg' });
if (!tv.includes("onclick=\"showDetail(202, 'tv')\"")) {
  throw new Error('TV cards must retain episode selection in the detail view');
}

console.log('PASS: movies play directly while TV cards retain episode selection');
