FROM node:12.10.0@sha256:28ab4c8ed6c0c31326fbe1fe594098ffd8cdb8cf42149f58ffe9d016d76a5a32

WORKDIR /opt/synamedia/signaling

# For use in the labels
ARG IMAGE_TAG=1
ARG VERSION=1.0.0
ARG BUILD_DATE=2021
ARG VCS_REF=unknown
ARG npm_package_description="This is Micro Service hyperscale signaling server"
ARG npm_package_repository_url=unknown
ARG npm_package_name=hyperscale-webrtc-signaling-server

EXPOSE $SERVICE_PORT

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

COPY package*.json ./

RUN npm ci

COPY . .

EXPOSE 9090

CMD [ "node", "server.js" ]
