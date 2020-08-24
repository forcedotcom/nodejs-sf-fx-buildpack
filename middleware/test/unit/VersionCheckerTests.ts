import { expect } from 'chai';
import 'mocha';

describe("versionChecker", function() {
  describe("versionsComatible", function() {
    const versionsCompatible = require('../../versionChecker').default;
    it('returns false when incompatbile', function() {
      expect(versionsCompatible("module", "0.1.1", "> 5.0")).to.be.false;
    });
    it('returns true when compatbile', function() {
      expect(versionsCompatible("fakemodule", "1.2.5", "~ 1.2.0")).to.be.true;
    });
  });
});
