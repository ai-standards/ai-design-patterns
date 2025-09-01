import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SectionNode } from './section-node';

describe('SectionNode', () => {
  let component: SectionNode;
  let fixture: ComponentFixture<SectionNode>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionNode]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SectionNode);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
