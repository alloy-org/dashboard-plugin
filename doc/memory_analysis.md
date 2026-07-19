# Analyzing component memory 

To analyze memory per component, start Chrome with garbage collection exposed:

```bash 
open -a "Google Chrome" --args --js-flags=--expose-gc
```

Then you can visit Settings -> Debug Tools -> Memory Management
