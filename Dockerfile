# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules

COPY --from=prerelease /usr/src/app/src ./src
COPY --from=prerelease /usr/src/app/public ./public
COPY --from=prerelease /usr/src/app/package.json .

# Runtime port
USER bun
# Pairing Port
EXPOSE 5502/tcp
# Matter Socket port
EXPOSE 5542/udp
EXPOSE 5542/tcp
# mDNS port
EXPOSE 5353/udp

# ENV
ENV MATTER_STORAGE_DRIVER="sqlite"
ENV DEBUG_COLORS=0

# 컴파일 없이 바로 실행
ENTRYPOINT [ "bun", "run", "src/index.ts" ]