# sf-fx-middlewarre

`make package` to generate the middleware buildpack tgz 

To use the build pack... it must be put after the npm (as the buildpack is written in typescript, it needs npm to install tsc to compile to js)

```
pack build jq-hello1 \
	-v --clear-cache -e NPM_TOKEN \
	--builder heroku/functions-buildpacks-debug \
	--buildpack=heroku/nodejs-engine-buildpack \
	--buildpack=heroku/nodejs-npm-buildpack \
	--buildpack=/Users/jqian/git/sf-fx-middleware/sf-fx-middleware-buildpack-v0.0.1.tgz \
	--buildpack=heroku/node-function 
  
evergreen functions:build jq-hello2 \
	-v --clear-cache -e NPM_TOKEN \
	--buildpack=heroku/nodejs-engine-buildpack \
	--buildpack=heroku/nodejs-npm-buildpack \
	--buildpack=/Users/jqian/git/sf-fx-middleware/sf-fx-middleware-buildpack-v0.0.1.tgz \
	--buildpack=heroku/node-function
```
  
