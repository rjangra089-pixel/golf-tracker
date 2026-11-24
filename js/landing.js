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
    for (const link of auth.querySelectorAll('[data-auth-tab]')) {
        link.addEventListener('click', event => {
            event.preventDefault();
            switchAuthTab(link.dataset.authTab);
            const heading = document.getElementById('auth-heading');
            heading.scrollIntoView({block: 'start'});
            heading.focus({preventScroll: true});
        });
    }
}
