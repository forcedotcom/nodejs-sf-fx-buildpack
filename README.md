# nodejs-sf-fx-buildpack

This is the middleware for Evergreen Functions.

Everytime a version changes is made to build.toml, and the change is merged back to master branch. The circleci build-and-release workflow will automatically git tag it with the new version, then create a git release with the version tag, the release will also include the packaged tgz file to be used by other builder.

**Note**: Newer version of the release binary (tgz) should be updated to the [pack-image git repo](https://github.com/heroku/pack-images)

`make package` to generate the middleware buildpack tgz 

To use the build pack... it must be put after the npm (as the buildpack is written in typescript, it needs npm to install tsc to compile to js)

```
pack build jq-hello1 \
	-v --clear-cache -e NPM_TOKEN \
	--builder heroku/functions-buildpacks-debug \
	--buildpack=heroku/nodejs-engine-buildpack \
	--buildpack=heroku/nodejs-npm-buildpack \
	--buildpack=/Users/jqian/git/sf-fx-middleware/nodejs-sf-fx-buildpack-v0.0.6.tgz \
	--buildpack=heroku/node-function 
  
evergreen functions:build jq-hello2 \
	-v --clear-cache -e NPM_TOKEN \
	--buildpack=heroku/nodejs-engine-buildpack \
	--buildpack=heroku/nodejs-npm-buildpack \
	--buildpack=/Users/jqian/git/sf-fx-middleware/nodejs-sf-fx-buildpack-v0.0.6.tgz \
	--buildpack=heroku/node-function
```


  
