var application_root = __dirname,
    express = require("express"),
    path = require("path"),
    mongoose = require('mongoose'),
    bodyParser = require('body-parser'),
    methodOverride = require('method-override'),
    morgan = require('morgan');

mongoose.Promise = require('bluebird');



var app = express();

// database
console.log("Connecting to db...");
mongoose.connect(process.env.MONGO);

// config
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

var Students = new Schema({
    name: { 
      type: String, 
      required: [true, "Must have a student name"],
      min: 2,
      max: 50
    },
    phoneNumber: { 
      type: Number, 
      validate: function(phoneNumber) { return phoneNumber.length == 10 }
    },
    studenId: { type: Number, required: [true, "Student ID is required"] },
    modified: { type: Date, default: Date.now }
});


// Appoinments Model
var Appointment = new Schema({
    description: { 
      type: String, 
      required: [true, 'Description required'],
      min: 5,
      max: 100
    },
    student: [Students],
    advisorId: { 
      type: String, 
      required: [true, 'Advisor required for appoinment'],
      validate: {
          validator: function(advisorId) {
            var promise = AdvisorModel.findById(advisorId).exec();
            promise.then(function(advisor) {
              return advisor.status == 'Available' || advisor.satus == 'Busy';
            })
            .catch(function(err) {
              return false;
           })},
          message : '{VALUE} is not a valid advisor!'
        }
    },
    state: { 
      type: String,
      enum: ['Waiting', 'In Progress', 'done'],
      default: 'Waiting',
    },
    type: { 
        type: String, 
        enum: ['Advising', 'Drop', 'Other'],
        required: 'Appoinment type required'
    },
    extraInfo: { type: String },
    position: { type: Number, default: -1 },
    modified: { type: Date, default: Date.now }
});


var AppoinmentModel = mongoose.model('Appointment', Appointment);

/* Appoinment Document 
[
{  
  "description": "I need to DROP",    
  "type": "DROP",
  "student": [{
    "name": "Leeroy Jenkins",
    "studenId": 10005959
  }],
  "advisor" : "STEFAN",
  "extraInfo": "Hey, where is Dr. Beckers office?"
}
]
*/


// Queue stuff
console.log("Initializing queue...");
var queue = [];

var promise = AppoinmentModel.find().exec() 

promise.then(function(appoinments) {
  console.log("Saved queue");
    console.log(appoinments);
    for(var i = 0; i < appoinments.length; i++) {
      var pos = appoinments[i].position;
      queue[pos] = appoinments[i];
    }
})
.catch(function(err) {
  console.log(err);
  console.log("Could not recover stored state");
});

function dequeue_app() {
  if(queue.length == 1) {
    queue = [];
  } 
  else {
    for(var i = 0; i < queue.length - 1; i++) {
      queue[i] = queue[i + 1];
    }
  }
}

// REST api

app.get('/api', function (req, res) {
  res.send('Kiosk API is running');
});

// POST to CREATE
app.post('/api/appointments', function (req, res) {
  var appoinment = new AppoinmentModel({
    description: req.body.description,
    student: req.body.student,
    advisorId: req.body.advisorId,
    type: req.body.type,
    extraInfo: req.body.extraInfo,
    position: queue.length + 1
  });
  
  appoinment.save(function (err) {
    if (!err) {
      queue.push(appoinment);
      console.log("Place in queue");
      console.log(queue[queue.length - 1].position)
      return res.send(appoinment)
    } else {
      return res.send(err)
    }
  });
});

// PUT to UPDATE

// Bulk update
app.put('/api/appoinments', function (req, res) {
    var i, len = 0;
    console.log("is Array req.body.appoinments");
    console.log(Array.isArray(req.body.appoinments));
    console.log("PUT: (appoinments)");
    console.log(req.body.appoinments);
    if (Array.isArray(req.body.appoinments)) {
        len = req.body.appoinments.length;
    }
    for (i = 0; i < len; i++) {
        console.log("UPDATE appoinment by id:");
        for (var id in req.body.products[i]) {
            console.log(id);
        }
        AppoinmentModel.update({ "_id": id }, req.body.products[i][id], function (err, numAffected) {
            if (err) {
                console.log("Error on update");
                console.log(err);
                return res.send(err);
            } else {
                console.log("updated num: " + numAffected);
                return res.send(req.body.appoinments)
            }
        });
    }
});

// Single update
app.put('/api/appoinments/:id', function (req, res) {
  return AppoinmentModel.findById(req.params.id, function (err, appoinment) {
    appoinment.description = req.body.description;
    appoinment.student = req.body.student;
    appoinment.advisor = req.body.advisor;
    appoinment.type = req.body.type;
    appoinment.extraInfo = req.body.extraInfo;
    return appoinment.save(function (err) {
      if (!err) {
        console.log("updated");
        return res.send(appoinment);
      } else {
        console.log(err);
        return res.send(err);
      }
    });
  });
});

// GET to READ

// List Appoinments
app.get('/api/appointments', function (req, res) {
  return AppoinmentModel.find(function (err, appoinments) {
    if (!err) {
      return res.send(queue);
    } else {
      return res.send(err);
    }
  });
});

// Single appoinment
app.get('/api/appointments/:id', function (req, res) {
  return AppoinmentModel.findById(req.params.id, function (err, appoinment) {
    if (!err) {
      return res.send(appoinment);
    } else {
      return res.send(err);
    }
  });
});

// DELETE to DESTROY

// Bulk destroy all appoinments
app.delete('/api/appointments', function (req, res) {
  AppoinmentModel.remove(function (err) {
    if (!err) {
      console.log("removed");
      queue = [];
      return res.send('');
    } else {
      return res.send(err);
    }
  });
});

// remove a single appoinment
app.delete('/api/appointments/:id', function (req, res) {
  return AppoinmentModel.findById(req.params.id, function (err, appoinment) {
    return appoinment.remove(function (err) {
      if (!err) {
        dequeue_app();
        console.log("removed");
        return res.send('');
      } else {
        return res.send(err);
      }
    });
  });
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
app.get('/api/advisors/:id', function (req, res) {
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
app.listen(4242);
console.log("Listening on 4242...");
