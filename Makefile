VERSION := "v$$(cat buildpack.toml | grep -m 1 version | sed -e 's/version = //g' | xargs)"

#create a tarball that includes bin, ts source, and compiled js
package: clean build
	@tar cvzf nodejs-sf-fx-buildpack-$(VERSION).tgz buildpack.toml bin/ middleware/*.ts middleware/*.json middleware/dist/*.js

#compile middleware ts to js
build:
	@cd middleware && npm run build

#remove old tarball
clean:
	@rm -f nodejs-sf-fx-buildpack-$(VERSION).tgz
