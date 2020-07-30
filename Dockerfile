FROM heroku/functions-buildpacks

# Need to specify --build-arg 1.x.x at build time
ARG FNVERS=0.0.0

ADD nodejs-sf-fx-buildpack-v${FNVERS}.tgz /cnb/buildpacks/salesforce_nodejs-fn/${FNVERS}

USER root
RUN set -xe && \
    cd /cnb/buildpacks/evergreen_fn/ && \
    cd $(/bin/ls -1 | egrep '^[0-9][0-9.]*') && \
    sed -i -e '/salesforce[/]nodejs-fn/{n;d;}' buildpack.toml && \
    echo '    version = "'${FNVERS}'"' >> buildpack.toml && \
    cat buildpack.toml && \
    true
USER heroku

