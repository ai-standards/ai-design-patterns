import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserStory } from './user-story';

describe('UserStory', () => {
  let component: UserStory;
  let fixture: ComponentFixture<UserStory>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserStory]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UserStory);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
