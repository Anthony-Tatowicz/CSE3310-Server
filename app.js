var config;

// Check if config file exists
try {
  config = require('./config.js');
} catch(e) {
  console.error('It looks like you don\'t have the config file...');
  console.error('We cant start the car without any keys now can we?');
  process.exit();
}

var application_root = __dirname,
    express = require("express"),
    path = require("path"),
    fs = require('fs'),
    mongoose = require('mongoose'),
    bodyParser = require('body-parser'),
    methodOverride = require('method-override'),
    morgan = require('morgan'),
    Pusher = require('pusher'),
    mailgun = require('mailgun-js')({apiKey: config.mailgun.key, domain: config.mailgun.domain});
    twilio = require('twilio');
    twilioClient = new twilio.RestClient(config.twilio.acc, config.twilio.token);
    cors = require('cors');

mongoose.Promise = require('bluebird');


const CHANNEL = 'test_channel';

var app = express();
var pusher = new Pusher({
  appId: config.pusher.app,
  key: config.pusher.key,
  secret: config.pusher.secret,
  encrypted: true
});

// database
console.log("Connecting to db... " + config.mongo);
mongoose.connect(config.mongo);

// config
app.use(cors());
app.use(bodyParser.json());
app.use(methodOverride());
app.use(express.static(path.join(application_root, "public")));
app.use(clientErrorHandler);
app.use(errorHandler);
app.use(morgan('combined'));


var Schema = mongoose.Schema; //Schema.ObjectId

// Schemas

var Advisors = new Schema({
    name: { type: String, required: [true, "Must have a name"] },
    status: { 
        type: String, 
        required: [true, "Must have a status"], 
        enum: ["Busy", "Available", "Unavailable"] ,
        default: "Unavailable"
      },
    turnOverRate: { type: Number },
    avgPerHour: { type: Number },
    modified: { type: Date, default: Date.now }
});

var AdvisorModel = mongoose.model('Advisor', Advisors);

var CourseCatalogModel = mongoose.model('CourseCatalog', new Schema({
  title: String,
  desc: String
}), 'course_catalog');

var Students = new Schema({
    name: { 
      type: String, 
      required: [true, "Must have a student name"],
      minlength: [2, 'Student name is required'],
    },
    phoneNumber: Number,
    studentId: { type: Number },
    modified: { type: Date, default: Date.now }
});


// Appointment Model
var Appointment = new Schema({
    description: { 
      type: String, 
      required: [true, 'Description required'],
      min: 5,
      max: 100
    },
    student: [Students],
    advisorId: { 
      type: String
    },
    state: { 
      type: String,
      enum: ['Waiting', 'In Progress', 'Done'],
      default: 'Waiting',
    },
    type: { 
        type: String, 
        enum: ['Advising', 'Drop', 'Other'],
        required: 'Wrong Appointment Type or No appointment Type'
    },
    extraInfo: { type: String },
    comment: String,
    position: { type: Number, default: -1 },
    modified: { type: Date, default: Date.now }
});


var AppointmentModel = mongoose.model('Appointment', Appointment);

/* Appointment Document 
{  
  "description": "I need to DROP",    
  "type": "Drop",
  "student": [{
    "name": "Leeroy Jenkins",
    "studenId": 10005959
  }],
  "advisorId" : "5833af88321f5f26ccd9231b",
  "extraInfo": "Hey, where is Dr. Beckers office?"
  "state": "Waiting" ( optional or for updates)
}
*/

/* Advisor Document
    {
        "name": "Barach",
        "status": "Busy"
    }
*/


// Queue stuff
console.log("Initializing queue...");
var queue = [];

var promise = AppointmentModel.find().exec() 

promise.then(function(appointment) {
  console.log("Saved queue");
  console.log(appointment);
  for(var i = 0; i < appointment.length; i++) {
    if(appointment.state !== "Done") {
      var pos = appointment[i].position;
      queue[pos] = appointment[i];
    }
  }
})
.catch(function(err) {
  console.log(err);
  console.log("Could not recover stored state");
});

function dequeue_app(idx) {
  if(queue.length == 1) {
    console.log("Queue length of 1 making new Array");
    queue = [];
  } 
  else {
    console.log("Removing -> " + queue[idx])
    for(var i = idx; i < queue.length - 1; i++) {
      console.log("UDATE -> " + queue[i+1].id);
      var promise = AppointmentModel.findById(queue[i+1].id).exec();
      promise.then(function(appointment) {
        console.log("Updating -> " + appointment)
        appointment.position = i;
        return appointment.save();
      })
      .then(function(appointment) {
        queue[i] = queue[i + 1];
        queue[i].position = i;
      })
      .catch(function(err) {
        console.log(err);
      })
    }
    queue.pop();
  }
}


// function move(to_pos, from_pos) {
//   if(idx < 0) return;
//   for(var i = to_pos; i < queue.length; i++) {
//     var temp = queue[to_pos];
//     queue[to_pos] = queue[from_pos];
//   }
// }

// REST api

app.get('/api', function (req, res) {
  res.send('Kiosk API is running');
});

// POST to CREATE
app.post('/api/appointments', function (req, res) {
  console.log('creating appointment');
  console.log(req.body);
  var appointment = new AppointmentModel({
    description: req.body.description,
    student: [req.body.student],
    advisorId: req.body.advisorId,
    type: req.body.type,
    extraInfo: req.body.extraInfo,
    position: queue.length
  });
  
  appointment.save(function (err) {
    if (!err) {
      queue.push(appointment);
      console.log("Place in queue");
      console.log(queue[queue.length - 1].position)

      // Pusher
      pusher.trigger('kiosk', 'new_appointment', appointment);

      return res.send(appointment)
    } else {
      var msg = err.message;

      if(err.name === 'ValidationError') {
        msg = err.errors[Object.keys(err.errors)[0]].message;
        console.log(msg);
      }
      //console.log(err);
      return res.status(400).send({error: msg});
    }
  });
});

// PUT to UPDATE

// Bulk update
// app.put('/api/appointments', function (req, res) {
//     var i, len = 0;
//     console.log("is Array req.body.appointment");
//     console.log(Array.isArray(req.body.appointment));
//     console.log("PUT: (appointment)");
//     console.log(req.body.appointment);
//     if (Array.isArray(req.body.appointment)) {
//         len = req.body.appointment.length;
//     }
//     for (i = 0; i < len; i++) {
//         console.log("UPDATE appointment by id:");
//         for (var id in req.body.appointment[i]) {
//             console.log(id);
//         }
//         AppointmentModel.update({ "_id": id }, req.body.appointment[i][id], function (err, numAffected) {
//             if (err) {
//                 console.log("Error on update");
//                 console.log(err);
//                 return res.send(err);
//             } else {
//                 console.log("updated num: " + numAffected);
//                 return res.send(req.body.appointment)
//             }
//         });
//     }
// });

// Single update
app.put('/api/appointments/:id', function (req, res) {
  return AppointmentModel.findById(req.params.id, function (err, appointment) {
    appointment.description = req.body.description;
    appointment.student = req.body.student;
    appointment.advisor = req.body.advisor;
    appointment.type = req.body.type;
    appointment.extraInfo = req.body.extraInfo;
    return appointment.save(function (err) {
      if (!err) {
        console.log("updated");
        queue[appointment.position] = appointment;
        return res.send(appointment);
      } else {
        console.log(err);
        return res.send(err);
      }
    });
  });
});

// Update Appointment state
app.put('/api/appointments/:id/state', function (req, res) {
  return AppointmentModel.findById(req.params.id, function (err, appointment) {
    appointment.state = req.body.state;
    return appointment.save(function (err) {
      if (!err) {
        console.log("updated");
        queue[appointment.position] = appointment;
        return res.send(appointment);
      } else {
        console.log(err);
        return res.send(err);
      }
    });
  });
});

// GET to READ

// List appointment
app.get('/api/appointments', function (req, res) {
  AppointmentModel.find({state: { $ne: 'Done' }})
    .then(apps => {
      return res.send(apps);
    })
});

// Single appointment
app.get('/api/appointments/:id', function (req, res) {
  return AppointmentModel.findById(req.params.id, function (err, appointment) {
    if (!err) {
      return res.send(appointment);
    } else {
      return res.send(err);
    }
  });
});

// Get next up
app.get('/api/next', function (req, res) {
  console.log(queue[0])
  return res.send(queue[0]);
});

app.post('/api/appointments/next', (req, res) => {
  var advisorId = req.body.advisorId;
  var next = null;

  AppointmentModel.findOne({advisorId: null, state: 'Waiting'})
    .then(apt => {
      if(!apt) throw new Error('No appointments');
      apt.state = 'In Progress';
      apt.advisorId = advisorId;
      pusher.trigger('kiosk', 'update_appointment', apt);
      return apt.save();
    })
    .then(apt => res.send(apt))
    .catch(e => {
      res.status(400).send({error: e.message});
    })
});

app.post('/api/appointments/:id/done', (req, res) => {
  var advisorId = req.body.advisorId;
  var next = null;

  AppointmentModel.findById(req.params.id)
    .then(apt => {
      if(!apt) throw new Error('No appointment');
      apt.state = 'Done';
      apt.comment = req.body.comment;
      pusher.trigger('kiosk', 'remove_appointment', apt);
      return apt.save();
    })
    .then(apt => res.send(apt))
    .catch(e => {
      res.status(400).send({error: e.message});
    })
});

// Check if advisor is in an apt
app.get('/api/advisors/:id/current', (req, res) => {
  AppointmentModel.findOne({advisorId: req.params.id, state: 'In Progress'})
    .then(apt => res.send(apt));
});

// DELETE to DESTROY

// Bulk destroy all appointment
app.delete('/api/appointments', function (req, res) {
  AppointmentModel.remove(function (err) {
    if (!err) {
      console.log("removed");
      queue = [];
      return res.send(queue);
    } else {
      return res.send(err);
    }
  });
});

// remove a single appointment
app.delete('/api/appointments/:id', function (req, res) {
  var promise = AppointmentModel.findById(req.params.id).exec();
  promise.then(function(appointment) {
    return appointment.remove();
  })
  .then(function(appointment) {
    dequeue_app(appointment.position);
    return res.send(queue);
  })
  .catch(function(err) {
    res.send(err);
  });
});

// Remove next up
app.delete('/api/next', function (req, res) {
  console.log('Removing -->' + queue[0].id)
  dequeue_app(0);
  res.send(queue);
});

app.post('/api/login', (req, res) => {
  const name = req.body.username;

  AdvisorModel.findOne({ name: name })
    .then(advisor => {
      if(!advisor) throw new Error('Advisor not found');
      advisor.status = 'Available';
      pusher.trigger('kiosk', 'advisor_available', advisor);
      return advisor.save();
    })
    .then(advisor => res.send(advisor))
    .catch(e => {
      res.status(400).send({error: e.message});
    })
})

app.post('/api/logout', (req, res) => {
  const name = req.body.username;

  AdvisorModel.findOne({ name: name })
    .then(advisor => {
      if(!advisor) throw new Error('Advisor not found');
      advisor.status = 'Unavailable';
      pusher.trigger('kiosk', 'advisor_unavailable', advisor);
      return advisor.save();
    })
    .then(advisor => res.send(advisor))
    .catch(e => {
      res.status(400).send({error: e.message});
    })
})

app.get('/api/advisors/online', (req, res) => {
  AdvisorModel.count({status: {$ne: 'Unavailable'}})
    .then(count => res.send({count: count}));
});

// Add Advisor
app.post('/api/advisors', function (req, res) {
  var advisor;
  console.log("POST: ");
  console.log(req.body);
  advisor = new AdvisorModel({
    name: req.body.name,
    status: req.body.status
  });
  advisor.save(function (err) {
    if (!err) {
      console.log("created");
      return res.send(advisor);
    } else {
      console.log(err);
      return res.send(err);
    }
  });
});

// Update Advisor
app.put('/api/advisors/:id', function (req, res) {
  var promise = AdvisorModel.findById(req.params.id).exec();
  promise.then(function(advisor) {
    advisor.name = req.body.name
    advisor.status = req.body.status;
    return advisor.save();
  })
  .then(function(advisor) {
    console.log("Advisor Saved!");
    return res.send(advisor);
  })
  .catch(function(err) {
    console.log(err);
    return res.send(err);
  })
});

// Update Advisor Status
app.put('/api/advisors/:id/status', function (req, res) {
  var promise = AdvisorModel.findById(req.params.id).exec();
  promise.then(function(advisor) {
    advisor.status = req.body.status;
    return advisor.save();
  })
  .then(function(advisor) {
    console.log("Advisor Updated!");
    return res.send(advisor);
  })
  .catch(function(err) {
    console.log(err);
    return res.send(err);
  })
});

// Get Advisors
app.get('/api/advisors', function (req, res) {
 return AdvisorModel.find(function (err, advisors) {
    if (!err) {
      console.log("Getting Advisors");
      return res.send(advisors);
    } else {
      console.log(err);
      return res.send(err);
    }
  });
});

// Get Advisor by id
app.get('/api/advisors/:id', function (req, res) {
   return AdvisorModel.findById(req.params.id, function (err, advisor) {
    if (!err) {
      return res.send(advisor);
    } else {
      console.log(err);
      return res.send(err);
    }
  });
})

// Delete Advsior
app.delete('/api/advisors/:id', function (req, res) {
  return AdvisorModel.findById(req.params.id, function (err, advisor) {
    return advisor.remove(function (err) {
      if (!err) {
        console.log("removed");
        return res.send('');
      } else {
        console.log(err);
        return res.send(err);
      }
    });
  });
});

/* -- Email dropform -- */
app.post('/api/dropform', (req, res) => {
  var link = 'https://www.uta.edu/coed/_downloads/undergrad-advising/DropForm.pdf';
  var data = {
    from: 'Mav Kiosk <' + config.mailgun.email + '>',
    to: req.body.email,
    subject: 'Mav Kiosk - Drop Form',
    html: 'Hey, we see you wanted the drop form.<br />' +
      '<a href="' + link + '">' + link + '</a>'
  };

  mailgun.messages().send(data, function (error, body) {
    if(body) {
      res.send(body);
    }
    else if(error.message) {
      res.status(400).send({error: error.message});
    }
    
  });
});

/* -- Course Catalog --  */
app.get('/api/courses', (req, res) => {
  CourseCatalogModel.find().then(courses => {
    return res.send(courses);
  })
});

function sendUserText(number) {
  twilioClient.messages.create({
    body: 'It is your time to be advised',
    to: number,  // Text this number
    from: '+14695138782' // From a valid Twilio number
  }, function(err, message) {
      console.log(message.sid);
  });
}

function clientErrorHandler (err, req, res, next) {
  if (req.xhr) {
    res.status(500).send({ error: 'Something failed!' })
  } else {
    next(err)
  }
}

function errorHandler (err, req, res, next) {
  res.status(500)
  res.render('error', { error: err })
}


// launch server
app.listen(process.env.PORT || 4242);
console.log("Listening on 4242...");
