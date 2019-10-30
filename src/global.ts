let global;

if (typeof global !== 'undefined') {
  global = global;
} else if (typeof window !== 'undefined') {
  global = window;
} else if (typeof self !== 'undefined') {
  global = self;
} else {
  global = {};
}

export default global;
