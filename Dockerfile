# 공식 Bun 이미지 사용
# https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1

# 작업 디렉토리 설정
WORKDIR /usr/src/app

# 캐시를 활용하기 위해 패키지 파일만 먼저 복사
COPY package.json bun.lock ./

# 빌드가 필요 없으므로 프로덕션 의존성만 설치
RUN bun install --frozen-lockfile --production

# 애플리케이션 소스 코드 복사
# 컴파일 과정이 없으므로 작성한 ts 소스(src, libs 등)만 넘기면 됩니다.
# (.dockerignore 에 node_modules 를 추가하시길 권장합니다)
COPY . .

# 권한 설정 (루트 권한 대신 bun 사용자 사용)
USER bun

# Pair 포트
EXPOSE 5500/tcp
# Matter 통신 포트
EXPOSE 5540/udp
EXPOSE 5540/tcp
# mDNS 포트
EXPOSE 5353/udp

# ENV
ENV MATTER_STORAGE_DRIVER="sqlite"
ENV DEBUG_COLORS=0

# 컴파일 없이 바로 실행
ENTRYPOINT [ "bun", "run", "src/index.ts" ]