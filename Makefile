VERSION := "v$$(cat buildpack.toml | grep -m 1 version | sed -e 's/version = //g' | xargs)"

package: clean
	@tar cvzf sf-fx-middleware-buildpack-$(VERSION).tgz bin/ buildpack.toml middleware/

clean:
	@rm -f sf-fx-middleware-buildpack-$(VERSION).tgz
