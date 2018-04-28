FROM sipster-pjsip
MAINTAINER KINOSHITA minoru <5021543+minoruta@users.noreply.github.com>

ARG NODEJS=8

WORKDIR /root
RUN  mkdir sipster
COPY src sipster/src
COPY lib sipster/lib
COPY test sipster/test
COPY package.json sipster/
COPY package-lock.json sipster/
COPY binding.gyp sipster/

#
#   Prepare requirments to test
#
RUN apt -qq update \
&&  apt -qq install -y \
        python \
        curl \
        git \
&&  curl -sL https://deb.nodesource.com/setup_$NODEJS.x | sudo -E bash - \
&&  apt -qq install -y nodejs \
&&  npm -qq install -g node-gyp \
&&  apt-get clean \
&&  rm -rf /var/lib/apt/lists/*

#
#   Test
#
CMD cd /root/sipster \
&&  node --version \
&&  npm install --unsafe-perm > /dev/null \
&&  npm test \
&&  echo ====================================================== \
&&  echo ======================== GOOD ======================== \
&&  echo ======================================================
