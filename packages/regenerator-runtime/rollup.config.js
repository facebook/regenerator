import babel from 'rollup-plugin-babel';

var config = {
  format: process.env.BABEL_ENV,
  intro: "var undefined; // More compressible than void 0.",
  plugins: [
    babel({
    	plugins: ['external-helpers'],
    }),
  ],
}

export default config
