var crypto = require('crypto');
var qs = require('querystring');

/*
 * RFC 3986 compliant encoding.
 * We require this for creating the base string used in calculating signatures.
 * qs.escape alone leaves the extra special characters untouched.
 */
function encodeParameter(param) {
    return qs.escape(param).replace(/[!'()*]/g, function(c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function decodeParameter(param) {
    return qs.unescape(param);
}

function generateParameterString(params, ignore_sig) {
    var paramString = '';

    Object.keys(params).sort().forEach(function(key) {
        if (!ignore_sig || key !== 'oauth_signature') {
            var val = params[key];
            paramString += (paramString ? '&' : '');
            paramString += key + '=' + encodeParameter(val);
        }
    });
    return paramString;
}

function getOAuthHeader(params) {
    var header = '';

    for (var key in params) {
        header += (header ? ', ' : '') + key + '="' + encodeParameter(params[key])+'"';
    }
    return 'OAuth '+header;
}

function oauthSignature(signatureParams) {
    var params = signatureParams;

    var self = this;

    self.toForm = function() {
        return generateParameterString(params);
    };

    self.toHeader = function() {
        return getOAuthHeader(params);
    };

    self.toObject = function() {
        return params;
    }

    return self;
}

function oauther(config) {
    var self = this;
    this.consumer = config.consumer;
    this.token = config.token;
    this.signature_method = config.signature_method || 'HMAC-SHA1';
    this.nonce_length = config.nonce_length || 32;
    this.version = '1.0';

    function getAllParams(req) {
        var params = {};

        for (let key in req.body) {
            params[key] = req.body[key];
        }
        for (let key in req.query) {
            params[key] = req.query[key];
        }
        var oauthparams = getOAuthHeaderParams(req);
        for (let key in oauthparams) {
            params[key] = oauthparams[key];
        }

        return params;
    }

    function getOAuthHeaderParams(req) {
        var oauthParams = {};

        if (req.header) {
            if (req.header('Authorization') && req.header('Authorization').match(/^OAuth/)) {
                var params = req.header('Authorization').match(/(oauth_)([^=\s]+)="([^"]*)"([^,]*)/g);
                params.forEach(function(p) {
                    var kv = p.match(/([^=\s]+)="([^"]*)"/);
                    oauthParams[decodeParameter(kv[1])] = decodeParameter(kv[2].replace(/"/g,''));
                });
            }
        }
        return oauthParams;
    }

    function parseURL(req) {
        // If we are in the express context, we will have req.header as a function.
        // Express version 4 strips the port out of the req.hostname parameter incorrectly
        var host = typeof req.header === 'function' ? req.header('Host') : req.hostname;
        var port = req.port;
        var mount = req.baseUrl || '';
        var path = req.path || '';

        var baseURL = (req.protocol ? req.protocol : 'http') + '://' + host;

        if (port) {
            baseURL += ':' + port;
        }

        baseURL += mount + path;

        return baseURL;
    }

    function getNonce() {
        var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        var nonce = '';

        for (var i = 0; i < self.nonce_length; i++) {
            nonce += chars[parseInt(Math.random() * chars.length, 10)];
        }

        return nonce;
    }

    function generateSignature(method, baseURL, params) {
        params.oauth_signature_method = self.signature_method;
        params.oauth_consumer_key = self.consumer.key;
        params.oauth_nonce = getNonce();
        params.oauth_timestamp = parseInt((new Date().getTime()) / 1000);
        params.oauth_version = self.version;
        if (config.token) {
            params.oauth_token = config.token.key;
        }
        var signature = calculateSignature(method, baseURL, params);
        params.oauth_signature = signature;
        return params;
    }

    function calculateSignature(method, baseURL, params) {
        var baseString = method.toUpperCase() + '&' + encodeParameter(baseURL) + '&' +
            encodeParameter(generateParameterString(params, true));

        var csecret = config.consumer ? config.consumer.secret : '';
        var tsecret = config.token ? config.token.secret : '';

        var keyString = encodeParameter(csecret) + '&' + encodeParameter(tsecret);

        if (params['oauth_signature_method'] === 'PLAINTEXT') {
            return keyString;
        }
        else if (params['oauth_signature_method'] === 'HMAC-SHA1') {
            var hmac = crypto.createHmac('sha1', keyString);
            return hmac.update(baseString).digest('base64');
        }
        else {
            throw 'oauther :: Unsupported signature method : ' + params['oauth_signature_method'];
        }
    }

    /**
     * Sign OAuth request
     * @param  {Object} req data
     * {
     *     hostname : 'example.com',
     *     method : 'GET',
     *     path : '/path/to/url',
     *     port : 80, // optional
     *     protocol : 'http', // optional, default 'http'
     *     query, : { 'gaius' : 'baltar' },// optional, query string as json
     *     body : { 'kara' : 'thrace' } // optional, form encoded body as json
     * }
     * @return {Object} OAuth data object
     */
    this.sign = function(req) {
        var method = req.method;
        var baseURL = parseURL(req);
        var params = params = getAllParams(req);
        var oauthParams = generateSignature(method, baseURL, params);

        return oauthSignature(oauthParams);
    };

    /**
     * A http request to validate
     * @param  {Object} req request
     * @return {Object} true if the signature is valid
     */
    this.validate = function(req) {
        var method = req.method;
        var baseURL = parseURL(req);
        var params = getAllParams(req);

        if (!params['oauth_signature']) {
            return false;
        }

        var expect = calculateSignature(method, baseURL, params);

        return params['oauth_signature'] === expect;
    };

    return self;
}

module.exports = oauther;
