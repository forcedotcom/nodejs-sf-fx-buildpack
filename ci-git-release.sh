#!/usr/bin/env bash
set -eo pipefail

if [ "$CIRCLE_BRANCH" = "jqian/detectsdk" ]; then

    VERSION_TOML=v$(cat buildpack.toml | grep -m 1 version | sed -e 's/version = //g' | xargs)
    echo ${VERSION_TOML}

    RELEASE_TAG=`curl -H "Authorization: token ${GITHUB_CI_TOKEN}" --silent "https://api.github.com/repos/forcedotcom/sf-fx-middleware/releases" | jq -r '.[0].tag_name'`
    echo ${RELEASE_TAG}
    if [ "${VERSION_TOML}" != "${RELEASE_TAG}" ]; then
        echo "git tag ${VERSION_TOML}"
        git tag $VERSION_TOML
        echo "git push --tags origin ${CIRCLE_BRANCH}"
	    git push --tags origin ${CIRCLE_BRANCH} #master
        echo "ls -alh sf-fx-middleware-buildpack-${VERSION_TOML}.tgz"
        ls -alh sf-fx-middleware-buildpack-${VERSION_TOML}.tgz
        RELEASE_NAME="Prerelease by circleci on ${CIRCLE_BRANCH}-${VERSION_TOML}"
        echo $RELEASE_NAME
        echo "ghr"
        ghr -prerelease -n "${RELEASE_NAME}" -t ${GITHUB_CI_TOKEN} -u ${CIRCLE_PROJECT_USERNAME} -r ${CIRCLE_PROJECT_REPONAME} -c ${CIRCLE_BRANCH} -delete ${VERSION_TOML} sf-fx-middleware-buildpack-${VERSION_TOML}.tgz       
    fi
    #ghr -t ${GITHUB_CI_TOKEN} -u ${CIRCLE_PROJECT_USERNAME} -r ${CIRCLE_PROJECT_REPONAME} -c ${CIRCLE_SHA1} -delete ${VERSION_TOML} ./artifacts/    
fi
