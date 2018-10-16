/**
 * Created by ogeva on 7/1/2017.
 */
const express = require('express');
const router = express.Router();
const ObjectID = require('mongodb').ObjectID;
const logger = require('./logger');
const auth = require('./auth');
const jwt = require('jsonwebtoken');
const mailTester = require('./mailTester');


// indicates the api server is up
router.get('/alive', (req, res) => {
  mailTester.sendTestEmail(req.properties);
  res.status(200).send({
    success:true,
    api: true,
    smtp: true,
    db: true
  });
});


router.get('/properties', (req, res, next) => {
  res.json({
    serverBaseUri: req.properties.serverBaseUri,
    emailDeleteInterval: req.properties.emailDeleteInterval,
    emailDeleteAge: req.properties.emailDeleteAge,
    allowedDomains: req.properties.allowedDomains,
    customText: req.properties.customText,
    allowAutocomplete: req.properties.allowAutocomplete
  });
});

/**
 * get a token
 */
router.post('/auth/authenticate', (req, res, next) => {
  // if a token exists for the ip and is not expired
  req.db.collection('tokens').findOne({'ip': req.ip},
    function (err, result) {
      if (err) {
        logger.error(err);
        res.status(500).json({error: err.message});
        return;
      }
      if (result) {
        jwt.verify(result.token, req.properties.jwtSecret, function(err, decoded) {
          if (err) {
            logger.info('failed to verify token... renewing.');
            auth.createNewToken(req, res);
            return;
          } else {
            logger.info('Re-using token');
            res.status(200).json({
              success: true,
              token: result.token
            });
            return;
          }
        });

      } else {
        auth.createNewToken(req, res);
      }
    });
});

// route middleware to verify a token
router.use(auth.verifyToken);

/**
 * returns a list of mailbox names starting with the req.body.prefix
 */
router.post('/mailbox/autocomplete', (req, res) => {
  req.db.collection('mailboxes').find({'name': {'$regex' : '^' + req.body.prefix, '$options' : 'i'}},
    {'name': 1}).toArray(function (err, mailboxes) {
    if (err) {
      res.status(500).json(err);
    }
    res.status(200).send(mailboxes.map(mailbox => mailbox.name));
  });
});

/**
 * returns a list of mail metadata bojects in a specific mailbox
 */
router.get('/mailbox/:mailbox/email', (req, res, next) => {
  req.db.collection('mailboxes').findOne({'name': req.params.mailbox}, function (err, mailbox) {
    if (err) {
      return res.status(500).json(err);
    }
    if (!mailbox || mailbox.emails.length === 0) {
      return res.status(404).send({error: 'MAILBOX IS EMPTY!'});
    }
    res.status(200).send(mailbox.emails);
  });
});

/**
 * returns an email object in a specific mailbox
 */
router.get('/mailbox/:mailbox/email/:emailId', (req, res) => {

  const objectId = ObjectID.createFromHexString(req.params.emailId);
  req.db.collection('emails').findOne({'_id': objectId}, {
    'from': 1,
    'to': 1,
    'cc': 1,
    'date': 1,
    'timestamp': 1,
    'subject': 1,
    'html': 1,
    'textAsHtml': 1,
    'attachments.filename': 1
  }, function (err, doc) {
    if (err) {
      res.status(500).send({error: err});
    }
    if(doc) {
      res.status(200).send(doc);
    } else {
      res.status(404).send({ error: 'EMAIL NOT FOUND'});
    }
  });
});

/**
 * updates a specific email object in a specific mailbox
 */
router.patch('/mailbox/:mailbox/email/:emailId', (req, res) => {

  const objectId = ObjectID.createFromHexString(req.params.emailId);
  req.db.collection('mailboxes').updateOne({ 'name': req.params.mailbox, 'emails.emailId' : objectId},
    {$set: {'emails.$.isRead': req.body.isRead}},
    function (err, result) {
    if (err) {
      res.status(500).send({error: err});
    }
    res.status(200).send(result);
  });
});

/**
 * returns the attachment
 */
router.get('/mailbox/:mailbox/email/:emailId/attachments/:filename', (req, res) => {
  try {

    const objectId = ObjectID.createFromHexString(req.params.emailId);
    req.db.collection('emails').findOne({'_id': objectId}, function(err, mail) {
      const attachmentsFound = mail.attachments.filter(attachment => {
        return attachment.filename === decodeURI(req.params.filename);
      });
      console.log(attachmentsFound);
      res.setHeader('Content-Type', attachmentsFound[0].contentType);
      // res.setHeader('Content-disposition', 'attachment;filename=' + attachmentsFound[0].filename);
      res.setHeader('Content-Length', attachmentsFound[0].size);
      res.writeHead(200);
      res.end(attachmentsFound[0].content.buffer);
      }
    );
  } catch (e) {
    console.log(e);
    res.status(404).send({error: 'FILE NOT FOUND'});
  }
});

router.delete('/mailbox/:mailbox/email/:emailId', (req, res) => {
  const objectId = ObjectID.createFromHexString(req.params.emailId);
  req.db.collection('mailboxes').updateOne(
    { 'name' : req.params.mailbox },
    {$pull : {'emails' : {'emailId': objectId}}}
    , function (err, result) {
      if (err) {
        res.status(500).send({error: err});
      }
      res.json({success: true});

    }
  );
});

router.delete('/mailbox/:mailbox', (req, res) => {
  req.db.collection('mailboxes').remove({'name': req.params.mailbox}, function(err, result) {
    if (err) {
      res.status(500).send({error: err, succes: false});
    }
    res.json({success: true});
  });
});


module.exports = router;

