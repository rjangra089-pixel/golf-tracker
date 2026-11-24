// Public tour and account links use the existing auth screen and forms.
{
    const auth = document.getElementById('screen-auth');
    const steps = [...auth.querySelectorAll('.tour-step')];
    const progress = document.getElementById('tour-progress');
    const back = document.getElementById('tour-back');
    const next = document.getElementById('tour-next');
    const finish = document.getElementById('tour-finish');
    let activeStep = 0;

    function moveTour(direction) {
        steps[activeStep].hidden = true;
        activeStep += direction;
        const step = steps[activeStep];
        step.hidden = false;
        progress.textContent = `Step ${activeStep + 1} of ${steps.length}`;
        back.disabled = activeStep === 0;
        next.hidden = activeStep === steps.length - 1;
        finish.hidden = !next.hidden;
        step.querySelector('h3').focus();
    }

    back.addEventListener('click', () => moveTour(-1));
    next.addEventListener('click', () => moveTour(1));
    const landing = [auth.querySelector('.tour-header'), auth.querySelector('.tour-content')];
    const heading = document.getElementById('auth-heading');
    const returnButton = document.getElementById('tour-return');
    let accountTrigger;
    let landingScroll = 0;

    for (const control of auth.querySelectorAll('[data-auth-tab]')) {
        control.addEventListener('click', event => {
            event.preventDefault();
            accountTrigger = control;
            landingScroll = auth.scrollTop;
            switchAuthTab(control.dataset.authTab);
            landing.forEach(section => { section.hidden = true; });
            returnButton.hidden = false;
            auth.scrollTop = 0;
            heading.focus({preventScroll: true});
        });
    }

    returnButton.addEventListener('click', () => {
        landing.forEach(section => { section.hidden = false; });
        returnButton.hidden = true;
        auth.scrollTop = landingScroll;
        accountTrigger.focus({preventScroll: true});
    });

    for (const group of auth.querySelectorAll('[data-practice]')) {
        group.addEventListener('click', event => {
            const choice = event.target.closest('button');
            if (!choice) return;
            if (group.dataset.practice === 'single') {
                for (const option of group.querySelectorAll('button')) {
                    option.setAttribute('aria-pressed', String(option === choice));
                }
            } else {
                choice.setAttribute('aria-pressed', String(choice.getAttribute('aria-pressed') === 'false'));
            }
        });
    }
}
