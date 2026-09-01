import { useCallback, useEffect } from "react";

const handleToggleAlert = useCallback(() => {
    setIsAlertSubscriptionOpen(prev => {
        const next = !prev
        if(next) setIsAlertSubscriptionOpen(false)
        return next
    })
}, []);

useEffect(() => {
    function handleClickOutside(event){
        if(isAdvisoryOpen && advisoryRef.current && !advisoryRef.current.contains(event.target)){
            setIsAdvisoryOpen(false)
        }

        if(isAlertSubscriptionOpen && subscriptionRef.open && !subscriptionRef.current.contains(event.target)){
            setIsAlertSubscriptionOpen(false)
        }
    }

    document.addEventListener('mousedown', )
})