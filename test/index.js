/**
 * Created by dob on 05.05.14.
 */
var assert = require('assert'),
  mongolastic = require('../'),
  should = require('should'),
  mongoose = require('mongoose');

describe('mongolastic', function(){
  //mongoose.set('debug', true);
  var cat, CatSchema, CostumeSchema, ToySchema, costume, DogSchema, dog;
  before(function() {
    mongoose.connect('mongodb://localhost/mongolastic');
  var db = mongoose.connection;

  db.on('error', console.error.bind(console, 'connection error:'));
  db.once('open', function callback() {
    CostumeSchema = mongoose.Schema({
      name: {type: String},
      color: {type: String},
      integer: {type: Number, elastic: {mapping: {type: 'integer'}}}
    });
    CostumeSchema.plugin(mongolastic.plugin, {modelname: 'costume'});
    costume = mongoose.model('costume', CostumeSchema);

    ToySchema = mongoose.Schema({
      name: {type: String},
      price: {type: Number, elastic: {mapping: {type: 'integer', index: 'not_analyzed'}}},
      func_ig: {type: String, elastic: {ignore: true}},
    }, { elastic: { mapping: { type: 'nested' }}});

    CatSchema = mongoose.Schema({
      name: String,
      date: {type: Date, default: Date.now},
      costume: {type: mongoose.Schema.ObjectId, ref: 'costume', elastic: {popfields: 'name'}},
      toys: [ToySchema],
      url: {type: String, elastic: {mapping: {type: 'string', index: 'not_analyzed'}}},
      test: {
        integer: {type: Number, elastic: {mapping: {type: 'integer'}}},
        deep: {
          mystring: {type: String, elastic: {mapping: {type: 'string'}}},
          mystring_ig: {type: String, elastic: {mapping: {type: 'string'}}}
        }
      }
    }, { elastic: { ignore: ['test.deep.mystring_ig']}});
    CatSchema.plugin(mongolastic.plugin, {modelname: 'cat'});
    cat = mongoose.model('cat', CatSchema);

    cat.elastic = {
      mapping: {
      'location.geo': { type: 'geo_point', 'lat_lon': true }
      }
    };

    DogSchema = mongoose.Schema({
      name: String,
      date: {type: Date, default: Date.now},
      costume: {type: mongoose.Schema.ObjectId, ref: 'costume'}
    });
    DogSchema.plugin(mongolastic.plugin, {modelname: 'dog'});
    dog = mongoose.model('dog', DogSchema);
  });
  });

  describe('mongolastic', function () {
    it('should be a object', function () {
      assert('object' === typeof mongolastic);
    });
  });

  describe('create connection', function(){
    it('should create a connection', function(done){
      mongolastic.connect('mongolastic', {
        host: 'localhost:9200',
        sniffOnStart: true
      }, function(err, conn) {
        should.not.exist(err);
        conn.should.be.an.Object;
        done();
      });
    });

    it('should create the mapping for the cat model', function(done) {
      mongolastic.registerModel(cat, function(err, result) {
        should.not.exist(err);
        result.should.be.a.function;
        done();
      });
    });

    it('should return the mappings for the cat model', function(done) {
      mongolastic.indices.getMapping(cat.modelName, function(err, response, status) {
        should.not.exist(err);
        assert(status === 200);
        response['mongolastic-cat'].should.be.object;
        response['mongolastic-cat'].mappings.should.be.object;
        response['mongolastic-cat'].mappings.cat.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.costume.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.costume.properties.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.toys.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.toys.properties.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.toys.properties.price.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.test.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.test.properties.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.test.properties.integer.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.test.properties.deep.should.be.object;
        response['mongolastic-cat'].mappings.cat.properties.test.properties.deep.properties.should.be.object;
        done();
      });
    });

  });

  describe('save mongoose model', function() {
    var kitty;
    it('should create a new object in mongoose model', function(done) {
      kitty = new cat({ name: 'Zildjian' });
      kitty.save(function (err, result) {
        console.log('yo1');
        should.not.exist(err);
        result.should.be.an.Object;
        done();
      });
    });

    it('should update a mongoose object', function(done) {
      kitty.name = 'Zlatko';
      kitty.save(function (err, result) {
        console.log('yo2');
        should.not.exist(err);
        result.should.be.an.Object;
        // Add timeout after saving to give elasticsearch some time to index
        setTimeout(function() {
          done();
        }, 1000);
      });
    });

    it('should find the mongoose object', function(done) {
      var query = {
        'body': {
          'query': {
            'match': {'_id': kitty._id}
          }
        }
      };
      kitty.search(query, function(err, result) {
        should.not.exist(err);
        result.hits.hits[0].should.be.an.Object;
        done();
      });
    });

    it('should delete from index', function(done) {
      mongolastic.delete('cat', kitty.id, function(err, result) {
        should.not.exist(err);
        result.should.be.an.Object;
        done();
      });
    });

    it('should reindex mongoose object', function(done) {
      mongolastic.index('cat', kitty, function(err, result) {
        should.not.exist(err);
        result.should.be.an.Object;
      });
      // Add timeout after saving to give elasticsearch some time to index
      setTimeout(function() {
        done();
      }, 1000);
    });

    it('should sync mongodb', function(done) {
      cat.sync(function(errcount, resultcount) {
        errcount.should.eql(0);
        resultcount.should.eql(1);
        done();
      });
    });

    it('should delete the mongoose object', function(done) {
      kitty.remove(function(err) {
        should.not.exist(err);
        done();
      });
    });

    var bat;

    it('should create a new sub object in mongoose model', function(done) {
      bat = new costume({
        name: 'Batman',
        color: 'black'
      });
      bat.save(function (err, result) {
        should.not.exist(err);
        result.should.be.an.Object;
        done();
      });
    });

    it('should create a object with sub object in mongoose model', function(done) {
      var batcat = new cat({
        name: 'Batcat',
        costume: bat._id
      });
      batcat.save(function (err, result) {
        should.not.exist(err);
        result.should.be.an.Object;
        result.costume.should.be.an.Object;
        result.costume._id.should.be.an.Object;
        done();
      });
    });

    it('should create a object with deep fields in mongoose model', function(done) {
      var lynx = new cat({
        name: 'Lynx',
        test: {
          integer: 42,
          deep: {
            mystring: 'hello',
            mystring_ig: 'hello'
          }
        }
      });
      lynx.save(function (err, result) {
        should.not.exist(err);
        result.should.be.an.Object;
        result.test.should.be.an.Object;
        result.test.integer.should.be.an.Number;
        result.test.deep.should.be.an.Object;
        result.test.deep.mystring.should.be.an.String;
        result.test.deep.mystring_ig.should.be.an.String;
        done();
      });
    });

    it('should ignore specified fields in mongoose model', function(done) {
        var query = {
          'body': {
            'query': {
              'match': {'name': 'Lynx'}
            }
          }
        };
        cat.search(query, function(serr, sresult) {
          should.not.exist(serr);
          sresult.hits.hits[0].should.be.an.Object;
          sresult.hits.hits[0]._source.should.be.an.Object;
          sresult.hits.hits[0]._source.test.should.be.an.Object;
          sresult.hits.hits[0]._source.test.integer.should.be.an.Number;
          sresult.hits.hits[0]._source.test.deep.should.be.an.Object;
          sresult.hits.hits[0]._source.test.deep.mystring.should.be.an.String;
          sresult.hits.hits[0]._source.test.deep.should.not.have.property('mystring_ig');
          done();
        });
    });

    it('should create a new object with sub object in mongoose without specified fields', function(done) {
      var dogbat = new dog({
        name: 'DogBat',
        costume: bat._id
      });
      dogbat.save(function (err, result) {
        should.not.exist(err);
        result.should.be.an.Object;
        result.costume.should.be.an.Object;
        result.costume.name.should.be.an.String;
        result.costume.color.should.be.an.String;
        done();
      });
    });

    it('should increment and sync', function(done) {
      cat.findOneAndUpdate({name: 'Lynx'}, {$inc: {'test.integer': 1}}, function (err, result) {
        should.not.exist(err);
        result.should.be.an.Object;
        result.test.should.be.an.Object;
        result.test.integer.should.be.an.Number;
        result.test.integer.should.be.exactly(43);
        result.test.deep.should.be.an.Object;
        result.test.deep.mystring.should.be.an.String;

        var query = {
          'body': {
            'query': {
              'match': {'name': 'Lynx'}
            }
          }
        };
        setTimeout(function() {
          cat.search(query, function(serr, sresult) {
            should.not.exist(serr);
            sresult.hits.hits[0].should.be.an.Object;
            sresult.hits.hits[0]._source.should.be.an.Object;
            sresult.hits.hits[0]._source.test.should.be.an.Object;
            sresult.hits.hits[0]._source.test.integer.should.be.an.Number;
            sresult.hits.hits[0]._source.test.integer.should.be.exactly(43);
            sresult.hits.hits[0]._source.test.deep.should.be.an.Object;
            sresult.hits.hits[0]._source.test.deep.mystring.should.be.an.String;
            done();
          });
        }, 1000);
      });
    });

    it('should return the correct prefix', function(done) {
      assert.equal(mongolastic.getIndexName('model'), 'mongolastic-model');
      assert.equal(mongolastic.getIndexName('mongolastic-model'), 'mongolastic-model');
      done();
    });
  });

  after(function(done) {
    mongoose.connection.db.dropDatabase(function() {
      mongolastic.deleteIndex('*', function() {
        done();
      });
    });
  });
});
