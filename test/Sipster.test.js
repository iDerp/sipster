const sipster = require('../');
const mock_server = require('sip');
const debug = require('debug')('SIPSTER');
const EventEmitter = require('events');

const ENV = process.env;
const Domain = 'asterisk';
const MyID = '6001';
const CalleeID = '6002';
const HostAddress = ENV.ASTERISK_ADDRESS || '127.0.0.1';
const ServerPort = 5062;
const MyURI = `sip:${MyID}@${HostAddress}`;
const RegistrarURI = `sip:${HostAddress}:${ServerPort}`;
const CalleeURI = `sip:${CalleeID}@${HostAddress}:${ServerPort}`;
const ServerConfig = {
    port: ServerPort,
    logger: {
      send: (message, address) => debug(`SEND: ${JSON.stringify(message)}`),
      recv: (message, address) => debug(`RECV: ${JSON.stringify(message)}`)
    }
};
const accountConfig = {
    idUri: MyURI,
    regConfig: {
        registrarUri: RegistrarURI,
    },
    sipConfig: {
        authCreds: [{
            scheme: 'digest',
            realm: Domain,
            username: MyID,
            dataType: 0,
            data: MyID
        }],
    }
};

const TEST_HEADERS = [{
    hName: "x-test-header-name",
    hValue: "test-header-value"
}];
const TEST_HEADERS2 = [{
    hName: "x-test-header-name1",
    hValue: "test-header-value1"
}, {
    hName: "x-test-header-name2",
    hValue: "test-header-value2"
}];
const DEFAULT_REG_CONFIG = {
    registerOnAdd: true,
    contactParams: "",
    timeoutSec: 300,
    retryIntervalSec: 0,
    firstRetryIntervalSec: 0,
    randomRetryIntervalSec: 10,
    delayBeforeRefreshSec: 5,
    dropCallsOnFail: false,
    unregWaitMsec: 4000,
    proxyUse: 3,
};

const DEFAULT_SIP_CONFIG = {
    contactForced: "",
    contactParams: "",
    contactUriParams: "",
    authInitialEmpty: false,
    authInitialAlgorithm: "",
};
const sip_events = new EventEmitter();
const sdp = 'v=0\r\n'+
            'o=- 3736083706 3736083706 IN IP4 127.0.0.1\r\n'+
            's=-\r\n'+
            't=0 0\r\n'+
            'm=audio 4002 RTP/AVP 0\r\n'+
            'c=IN IP4 127.0.0.1\r\n'+
            'a=rtcp:4003 IN IP4 127.0.0.1\r\n'+
            'a=sendrecv\r\n'+
            'a=rtpmap:0 PCMU/8000\r\n';
const events = {
    registering: 0,
    unregistering: 0,
    registered: 0,
    unregistered: 0,
    state: 0,
    call: 0
};
const dialogs = {};
let account = {};
let call = {};
let cseq = 0;
let tag = 0;
let callId = 0;

/**
 * Complement the specified account config with default value.
 */
function makeAccountConfig(config) {
    if (config.regConfig) {
        const DEFAULT = DEFAULT_REG_CONFIG;
        config.regConfig = Object.assign(DEFAULT, config.regConfig);
    }
    if (config.sipConfig) {
        const DEFAULT = DEFAULT_SIP_CONFIG;
        config.sipConfig = Object.assign(DEFAULT, config.sipConfig);
    }
    return config;
}

function getTag() {
    return ++tag;
}

function getCallId() {
    return ++callId;
}

function getCseq() {
    return ++cseq;
}

function trim2check(message) {
    const m = JSON.parse(JSON.stringify(message));
    m.headers.via.forEach(via => {
        via.host = 'DNC';
        via.params.branch = 'DNC';
    });
    m.headers['call-id'] = 'DNC';
    m.headers.to.params.tag = 'DNC';
    m.headers.cseq.seq = 'DNC';
    m.headers.from.params.tag = 'DNC';
    m.headers['content-length'] = 'DNC';
    m.content = m.content.replace(/^o=-.+$/m, 'o=- DNC');
    m.content = m.content.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/mg, 'DNC');
    return m;
}

beforeAll(() => {
    mock_server.start(ServerConfig, (request, remote) => {
        debug('request: ', mock_server.stringify(request));
        sip_events.emit(request.method, request, remote);
    });
});

afterAll(() => {
    mock_server.stop();
});

describe('sipster', () => {
    test ('check static properties', () => {
        expect(sipster.version).toMatchSnapshot();
    });
    test ('initialize pjsip', () => {
        const configs = { logConfig: { level: 3, consoleLevel: 3}};
        sipster.init(configs);
        expect(sipster.config).toMatchSnapshot();
        expect(sipster.mediaActivePorts).toMatchSnapshot();
        expect(sipster.mediaMaxPorts).toMatchSnapshot();
        expect(sipster.state).toMatchSnapshot();
    });
    test ('set up a transport to listen for incoming connections, defaults to UDP', () => {
        transport = new sipster.Transport({ port: 5060 });
        const info = transport.getInfo();
        info.info = undefined;
        info.localName = undefined;
        expect(info).toMatchSnapshot();
        expect(transport.enabled).toMatchSnapshot();
    });
    test ('set up a SIP account, we need at least one', () => {
        // this sets up an account for calls coming from 192.168.100.10
        account = new sipster.Account(makeAccountConfig(accountConfig));
        account.on('registering', () => events.registering++);
        account.on('unregistering', () => events.unregistering++);
        account.on('registered', () => events.registered++);
        account.on('unregistered', () => events.unregistered++);
        account.on('state', (active, statusCode) => events.state++);
        account.on('call', (info, call) => events.call++);
        expect(account.getInfo()).toMatchSnapshot();
        expect(account.valid).toMatchSnapshot();
        expect(account.default).toMatchSnapshot();
    });
    test ('make an audio player', () => {
        player = sipster.createPlayer(`${__dirname}/waves/sound.wav`);
    });
    test ('make an audio recorder', () => {
        recorder = sipster.createRecorder(`${__dirname}/waves/call.wav`);
    });
    test ('finalize the pjsip initialization phase', done => {
        sip_events.once('REGISTER', request => {
            const response = mock_server.makeResponse(request, 200, 'OK');
            mock_server.send(response);
        });
        account.once('registered', () => {
            debug('an account has been registered');
            return done();
        });
        sipster.start();
    });
//
// Outbound call
//
    test ('make an outbound call', done => {
        debug('making an outbound call');
        sip_events.once('INVITE', request => {
            expect(trim2check(request)).toMatchSnapshot();
            const response = mock_server.makeResponse(request, 200, 'OK');
            response.headers['content-type'] = 'application/sdp';
            response.content = sdp;
            mock_server.send(response);
        });
        call = account.makeCall(CalleeURI, TEST_HEADERS);
        call.on('state', state => {
            if (state === 'confirmed') {
                debug('the calling confirmed');
                call.removeAllListeners('state');
                return done();
            }
        });
    });
    test ('hang up the outbound call', done => {
        debug('hanging up the outbound call');
        sip_events.once('BYE', request => {
            const response = mock_server.makeResponse(request, 200, 'OK');
            mock_server.send(response);
        });
        call.on('state', state => {
            if (state === 'disconnected') {
                debug('the calling has been disconnected');
                call.removeAllListeners('state');
                call = null;
                return done();
            }
        });
        call.hangup();
    });

//
// Outbound call #2 w/o custom headers
//
    test ('make an outbound call #2', done => {
        debug('making an outbound call #2');
        sip_events.once('INVITE', request => {
            expect(trim2check(request)).toMatchSnapshot();
            const response = mock_server.makeResponse(request, 200, 'OK');
            response.headers['content-type'] = 'application/sdp';
            response.content = sdp;
            mock_server.send(response);
        });
        call = account.makeCall(CalleeURI);
        call.on('state', state => {
            if (state === 'confirmed') {
                debug('the calling confirmed');
                call.removeAllListeners('state');
                return done();
            }
        });
    });
    test ('hang up the outbound call #2', done => {
        debug('hanging up the outbound call #2');
        sip_events.once('BYE', request => {
            const response = mock_server.makeResponse(request, 200, 'OK');
            mock_server.send(response);
        });
        call.on('state', state => {
            if (state === 'disconnected') {
                debug('the calling has been disconnected');
                call.removeAllListeners('state');
                call = null;
                return done();
            }
        });
        call.hangup();
    });

//
// Inbound call with custom headers
//
    test ('receive an inbound call', done => {
        debug('receive an inboud call');
        account.on('call', (info, inbound_call) => {
            debug('call', inbound_call);
            inbound_call.answer(TEST_HEADERS2);
            call = inbound_call;
        });
        mock_server.send({
            method: 'INVITE',
            uri: MyURI,
            headers: {
                to: {uri: MyURI},
                from: {uri: CalleeURI, params: {tag: getTag()}},
                'call-id': getCallId(),
                cseq: {method: 'INVITE', seq: getCseq()},
                'content-type': 'application/sdp',
                contact: [{uri: CalleeURI}]
            },
            content:
                'v=0\r\n'+
                'o=- 13374 13374 IN IP4 127.0.0.1\r\n'+
                's=-\r\n'+
                'c=IN IP4 127.0.0.1\r\n'+
                't=0 0\r\n'+
                'm=audio 4000 RTP/AVP 0\r\n'+
                'a=rtpmap:0 PCMU/8000\r\n'+
                'a=sendrecv\r\n'
        }, response => {
            expect(trim2check(response)).toMatchSnapshot();
            debug('an inbound call has been established');
            mock_server.send({
                method: 'ACK',
                uri: MyURI,
                headers: {
                    from: response.headers.from,
                    to: response.headers.to,
                    cseq: {method: 'ACK', seq: response.headers.cseq.seq},
                    'call-id': response.headers['call-id'],
                    via: [response.headers.via[0]],
                    'max-forwards': 70
                }
            });
            done();
        });
    });
    test ('hang up the inbound call', done => {
        debug('hanging up the inbound call');
        sip_events.once('BYE', request => {
            const response = mock_server.makeResponse(request, 200, 'OK');
            mock_server.send(response);
        });
        call.on('state', state => {
            if (state === 'disconnected') {
                debug('the calling has been disconnected');
                call.removeAllListeners('state');
                return done();
            }
        });
        call.hangup();
    });
//
// Unregister
//
    test ('unregister account', done => {
        debug('unregister the account');
        sip_events.once('REGISTER', request => {
            const response = mock_server.makeResponse(request, 200, 'OK');
            mock_server.send(response);
        });
        account.setRegistration(false);
        account.once('unregistered', () => {
            debug('the account has been unregistered');
            expect(sipster.state).toMatchSnapshot();
            expect(events).toMatchSnapshot();
            return done();
        });
    });
});
