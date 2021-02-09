FROM node:14-alpine

RUN mkdir -p /app && apk add bash curl
WORKDIR /app
ENV NODE_ENV production

COPY config/default.json config/
COPY lib lib
COPY package* ./
COPY server.js .

RUN npm install

ENTRYPOINT ["node", "server.js"]

# For use in the labels
ARG        BUILD_DATE
ARG        VCS_REF
ARG        IMAGE_TAG
ARG        BUNDLE_VERSION=$IMAGE_TAG
ARG npm_package_description="This is Micro Service hyperscale signaling server"
ARG npm_package_repository_url=unknown
ARG npm_package_name=hyperscale-webrtc-signaling-server


# these are the required labels. Some of the should be added by '--build-arg' parameter in the 'docker build' command
LABEL org.label-schema.schema-version=1.0.0-rc.1 \
      org.label-schema.name=$npm_package_name \
      org.label-schema.description=$npm_package_description \
      org.label-schema.vendor=Synamedia \
      org.label-schema.build-date=$BUILD_DATE \
      org.label-schema.vcs-type=git \
      org.label-schema.vcs-url=$npm_package_repository_url \
      org.label-schema.vcs-ref=$VCS_REF \
      org.label-schema.cisco.image_tag=$IMAGE_TAG \
      org.label-schema.version=$VERSION

