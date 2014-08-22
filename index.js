/**
 * Created by dob on 05.05.14.
 */
var elasticsearch = require('elasticsearch');
var indices = require('./lib/indices');
var instance;
var async = require('async');
//var _ = require('underscore');

/**
 * Module definition
 */

var mongolastic = function() {
  this.connection = null;
  this.prefix = null;
};

/////////////////////
// singleton stuff
////////////////////
instance = null;

var getInstance = function(){
  return instance || (instance = new mongolastic());
};

/**
 * Connects and tests the connection with a ping
 * @param prefix
 * @param options
 * @param callback
 */
mongolastic.prototype.connect = function(prefix, options, callback) {
  var self = this;
  // check if the prefix has been defined
  if(!this.prefix) {
    this.prefix = prefix;
  }

  // check if the connection has been defined
  if(!this.connection) {
    /*if(!options) {
      options = {};
    }
    options.log = {
      level: 'trace'
    }*/
    this.connection = new elasticsearch.Client(options);
  }

  if(!this.indices) {
    this.indices = new indices(this);
  }

  // check the connection with a ping to the cluster and reply the connection
  this.connection.ping({
    requestTimeout: 1000,
    hello: 'elasticsearch!'
  },function(err) {
    if(err) {
      callback(err);
    } else {
      callback(null, self.connection);
    }
  });
};

/**
 * Populates object references according to their elastic-options. Invoked on pre(save) and sync to enable synchronisation
 * of full object trees to elasticsearch index
 * @param doc
 * @param schema
 * @param callback
 */
mongolastic.prototype.populate = function populate(doc, schema, callback) {
  var elastic = getInstance();

  function populateReferences(options, currentpath, callback) {
    if(options && options.ref) {
      if(options.elastic && options.elastic.avoidpop ) {
        callback();
      } else {
        if(options.elastic && options.elastic.populate) {
          elastic.populateSubdoc(doc, schema, currentpath, options.elastic.populate, callback);
        } else if(options.elastic && options.elastic.popfields) {
          doc.populate(currentpath, options.elastic.popfields, callback);
        } else {
          doc.populate(currentpath, callback);
        }
      }
    } else {
      callback();
    }
  }

  async.each(Object.keys(schema.paths), function(currentpath, callback) {
    if(schema.paths[currentpath] && schema.paths[currentpath].options) {
      var options = schema.paths[currentpath].options;

      if(options.type instanceof Array) { //hande 1:n relationships []
        if(options.type[0] && options.type[0].type) { // direct object references
          options = schema.paths[currentpath].options.type[0];
          populateReferences(options, currentpath, callback);
        } else if(options.type[0]) {
          async.each(Object.keys(options.type[0]), function(key, cb) {
            var suboptions = options.type[0][key];
            var subpath = currentpath + '.' + key;
            populateReferences(suboptions, subpath, cb);
          }, function() {
            callback();
          });
        } else {
          callback();
        }
      } else {
        populateReferences(options, currentpath, callback);
      }
    }
  }, function(err) {
    if(err) {
      callback(new Error('Could not populate document: ' + err));
    }
    callback();
  });
};

mongolastic.prototype.populateSubdoc = function populateSubdoc(doc, schema, currentpath, options, callback) {

  var populateProperties = function(doc, properties, callback) {
    async.each(Object.keys(properties), function(property, cb) {
      doc.populate(property, function() {
        cb();
      });
    }, function(err) {
      if(err) {
        return callback(err);
      }
      callback();
    });
  };

  var populateRecursive = function(doc, key, options, callback) {
    if(doc.get(key) && options) {
      if(doc.get(key) instanceof Array) {
        async.each(doc.get(key), function(subdoc, cb) {
          populateProperties(subdoc, options, cb);
        },function(err) {
          if(err) {
            return callback(err);
          }
          return callback();
        });
      } else {
        populateProperties(doc.get(key), options, callback);
      }
    } else {
      callback();
    }
  };

  // first the currentpath has to be populated to get the subdocument(s)
  doc.populate(currentpath, function(err) {
    if(err) {
      callback(err);
    } else {
      populateRecursive(doc, currentpath, options, callback);
    }
  });
};

mongolastic.prototype.plugin = function plugin(schema, options) {
  if(options.modelname) {
    var elastic = getInstance();

    schema.pre('save', function(next, done) {
      var self = this;
      elastic.populate(self, schema, function(err) {
        if(!err) {
          elastic.index(options.modelname, self, function(err) {
            if(!err) {
              next();
            } else {
              done(new Error('Could not save in Elasticsearch index: ' + err));
            }
          });
        } else {
          done(new Error('Could not save in Elasticsearch: '+err));
        }
      });
    });

    schema.post('remove', function() {
      elastic.delete(options.modelname, this.id, function(err) {
        if(err) {
          console.log(err);
        }
      });
    });
    /**
     * Search on current model with predefined index
     * @param query
     * @param cb
     */
    schema.methods.search = function(query, cb) {
      query.index = elastic.getIndexName(options.modelname);
      elastic.search(query, cb);
    };

    /**
     * Search with specifiing a model or index
     * @type {search|Function|string|api.indices.stats.params.search|Boolean|commandObject.search|*}
     */
    schema.statics.search = elastic.search;

    schema.statics.sync = function (callback) {
      return elastic.sync(this, options.modelname, callback);
    };

  } else {
    console.log('missing modelname');
  }
};

/**
 * Render the mapping for the model
 * @param model
 * @param callback
 */
mongolastic.prototype.renderMapping = function(model, callback) {
  var deepen = function deepen(o) {
    var oo = {}, t, orig_parts, parts, part;
    for (var k in o) {
      if (o.hasOwnProperty(k)) {
        t = oo;
        orig_parts = k.split('.');
        var key = orig_parts.pop();
        parts = [];
        // if it's nested the schema needs the properties object added for every second element
        for (var i = 0; i < orig_parts.length; i ++) {
          parts.push(orig_parts[i]);
          parts.push('properties');
        }
        while (parts.length) {
          part = parts.shift();
          var mypart = t[part] = t[part] || {};
          t = mypart;
        }
        t[key] = o[k];
      }
    }
    return oo;
  };

  var mapping = {};
  mapping[model.modelName] = {
    properties: {

    }
  };

  // Recursive mapping (supports nested/subdocs)
  function map_create(k, currentkey, cb) {
    var currentPath = k.schema.paths[currentkey];
    if(currentPath && currentPath.options && currentPath.options.elastic && currentPath.options.elastic.mapping) {
      // Regular field
      k.mapping[currentkey] = currentPath.options.elastic.mapping;
      cb();
    } else if (currentPath && currentPath.options && currentPath.options.ref) {
      // Reference model/schema
      var refmodel = model.model(currentPath.options.ref);
      if (refmodel.schema.options && refmodel.schema.options.elastic && refmodel.schema.options.elastic.mapping) {
        k.mapping[currentkey] = refmodel.schema.options.elastic.mapping;
        k.mapping[currentkey].properties = {};
      } else {
        k.mapping[currentkey] = { properties: {} };
      }
      async.each(Object.keys(refmodel.schema.paths), 
        map_create.bind(null, {schema: refmodel.schema, mapping: k.mapping[currentkey].properties}),
        cb
      );
    } else if (currentPath && currentPath.schema) {
      // Subdoc/schema
      if (currentPath.schema.options && currentPath.schema.options.elastic && currentPath.schema.options.elastic.mapping) {
        k.mapping[currentkey] = currentPath.schema.options.elastic.mapping;
        k.mapping[currentkey].properties = {};
      } else {
        k.mapping[currentkey] = { properties: {} };
      }
      async.each(Object.keys(currentPath.schema.paths), 
        map_create.bind(null, {schema: currentPath.schema, mapping: k.mapping[currentkey].properties}),
        cb
      );
    } else {
      cb();
    }
  }

  async.series([
    function(callback) {
      async.each(Object.keys(model.schema.paths), 
        map_create.bind(null, { schema: model.schema, mapping: mapping[model.modelName].properties }), 
        function(err) {
          callback(err);
        }
      );
    },
    function(callback) {
      if(model.elastic && model.elastic.mapping) {
        async.each(Object.keys(model.elastic.mapping), function(currentkey, cb) {
          mapping[model.modelName].properties[currentkey] = model.elastic.mapping[currentkey];
          cb();
        }, function(err) {
          callback(err);
        });
      } else {
        callback();
      }
    }
  ],function(err) {
    var map = deepen(mapping[model.modelName].properties);
    mapping[model.modelName].properties = map;
    callback(err, mapping);
  });


};

/**
 * When registering a new mongoose model
 * @param model
 * @param callback
 */
mongolastic.prototype.registerModel = function(model, callback) {
  var elastic = getInstance();
  elastic.indices.checkCreateByModel(model,
    function(err) {
      callback(err, model);
    });
};

/**
 * Index data
 * @param modelname
 * @param entry
 * @param callback
 */
mongolastic.prototype.index = function(modelname, entry, callback) {
  var elastic = getInstance();

  var myid;
  if(entry && entry._id) {
    myid = entry._id.toString();
  }

  elastic.connection.index({
    index: elastic.getIndexName(modelname),
    type: modelname,
    id: myid,
    body: entry,
    refresh: true
  }, callback);
};

/**
 * Index data
 * @param modelname
 * @param entry
 * @param callback
 */
mongolastic.prototype.bulk = function(body, callback) {
  var elastic = getInstance();

  elastic.connection.bulk({
    //index: elastic.getIndexName(modelname),
    //type: modelname,
    body: body,
    refresh: true
  }, callback);
};

/**
 * Delete function
 * @param modelname
 * @param entry
 * @param callback
 */
mongolastic.prototype.delete = function(modelname, id, callback) {
  var elastic = getInstance();
  elastic.connection.delete({
    index: elastic.getIndexName(modelname),
    type: modelname,
    id: id
  }, callback);
};

/**
 * Search function
 * @param query
 * @param callback
 */
mongolastic.prototype.search = function(query, callback) {
  var elastic = getInstance();
  if(!query.index) {
    query.index = elastic.prefix + '-*';
  }
  elastic.connection.search(query, callback);
};

/**
 * Sync function for database model
 * @param model
 * @param modelname
 * @param callback
 */
mongolastic.prototype.sync = function sync(model, modelname, callback) {
  var elastic = getInstance();
  var stream = model.find().stream();
  var schema = model.schema;
  var errcount = 0;
  var rescount = 0;
  var doccount = 0;
  var donecount = 0;
  var bulk = [];
  var size = 1000;
  var step = 0;
  stream.on('data', function (doc) {
    doccount = doccount +1;
    stream.pause();
    elastic.populate(doc, schema, function(err) {
      step = step + 1;
      donecount = donecount +1;

      if(!err) {
        var action = {
          index: {
            '_index': elastic.getIndexName(modelname),
            '_type': modelname,
            '_id': doc._id.toString()
          }
        };
        bulk.push(action);
        bulk.push(doc);
      } else {
        console.err('error populate doc ' + doc._id + ' ' + err);
        if(err) {
          errcount = errcount +1;
        } else {
          rescount = rescount +1;
        }
      }

      if(step >= size) {
        elastic.bulk(bulk, function(err) {
          if(err) {
            console.err(err);
          }
          bulk = [];
          step = 0;
          stream.resume();
        });
      } else {
        stream.resume();
      }
    });
  });

  stream.on('end', function() {
    elastic.bulk(bulk, function(err) {
      if(err) {
        console.err(err);
      }
      callback(errcount, donecount);
    });
  });
};

/**
 * Delete whole index
 * @param modelname
 * @param callback
 */
mongolastic.prototype.deleteIndex = function deleteIndex(modelname, callback) {
  this.connection.indices.delete({index: this.getIndexName(modelname)}, callback);
};

/**
 * Helper for hamornising namespaces
 * @param modelname
 * @returns {string}
 */
mongolastic.prototype.getIndexName = function(name) {
  var mlelast = getInstance();
  if(mlelast.prefix) {
    if(name.indexOf(mlelast.prefix+'-') === 0) {
      return name.toLowerCase();
    } else {
      return mlelast.prefix + '-' + name.toLowerCase();
    }
  } else {
    return name.toLowerCase();
  }
};


module.exports = getInstance();
