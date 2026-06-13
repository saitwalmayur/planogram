import { TestBed } from '@angular/core/testing';

import { Planogramdata } from './planogramdata';

describe('Planogramdata', () => {
  let service: Planogramdata;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Planogramdata);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
