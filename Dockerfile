FROM ubuntu:latest

WORKDIR /app
COPY . /app/

RUN apt update

RUN curl -sL https://deb.nodesource.com/setup_18.x | bash
RUN apt install -y nodejs npm git iputils-ping ca-certificates curl sudo nscd util-linux

RUN npm ci
RUN npm run build

CMD [ "npm", "run", "start-server" ]